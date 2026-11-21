import { cache } from "react";
import {
  db,
  eq,
  eventTypes,
  participantProtocols,
  participants,
  protocolVersions,
  sql,
  studies,
  type COVERAGE_STATUS,
} from "@observatorio/db";

// Read models for the study list and the study overview. Callers must `await connection()` first.

export type CoverageStatus = (typeof COVERAGE_STATUS)[number];
// Time inside the participant's study period with no coverage row at all (nothing uploaded).
// ADR 0002 §5: it is shown as not observed, never as zero.
export type NoRecord = "no_record";
export type NotObservedStatus = Exclude<CoverageStatus, "observed"> | NoRecord;

export type StudyListItem = {
  code: string;
  title: string;
  status: string;
  participantCount: number;
};

export async function listStudies(): Promise<StudyListItem[]> {
  return db
    .select({
      code: studies.code,
      title: studies.title,
      status: studies.status,
      participantCount: sql<number>`count(${participants.id})::int`,
    })
    .from(studies)
    .leftJoin(participants, eq(participants.studyId, studies.id))
    .groupBy(studies.id)
    .orderBy(studies.createdAt);
}

export type ProtocolInUse = {
  versionLabel: string;
  status: string;
  publishedAt: Date | null;
  participantCount: number;
};

export type EventTypeColumn = { key: string; label: string };

/**
 * Seconds per coverage status, plus `no_record` for time inside the participant's study period
 * without any coverage row. Only statuses that actually occur are present.
 */
export type CoverageBreakdown = {
  /** Study period plus any coverage recorded outside it. */
  totalSeconds: number;
  observedSeconds: number;
  notObserved: { status: NotObservedStatus; seconds: number }[];
};

export type ParticipantOverview = {
  id: string;
  pseudonym: string;
  status: string;
  protocolLabel: string | null;
  /** Event type keys defined by the protocol versions this participant ran under. */
  measuredEventKeys: string[];
  /** Current observations (v_current_observations) by event type key. */
  observationCounts: Record<string, number>;
  coverage: CoverageBreakdown;
  /** Coverage per participant-local day (YYYY-MM-DD), oldest first. */
  days: ({ day: string } & CoverageBreakdown)[];
};

export type StudyOverview = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  status: string;
  protocolsInUse: ProtocolInUse[];
  eventTypes: EventTypeColumn[];
  participants: ParticipantOverview[];
};

// Memoized per request: the study layout and its pages both look the study up.
export const getStudyByCode = cache(async (code: string) => {
  const [study] = await db
    .select({ id: studies.id, code: studies.code, title: studies.title, description: studies.description, status: studies.status })
    .from(studies)
    .where(eq(studies.code, code));
  return study ?? null;
});

export async function getStudyOverview(code: string): Promise<StudyOverview | null> {
  const study = await getStudyByCode(code);
  if (!study) return null;

  // Assignment valid now; the no-overlap rule leaves at most one per participant.
  const currentAssignment = sql`${participantProtocols.validFrom} <= now()
    and (${participantProtocols.validTo} is null or ${participantProtocols.validTo} > now())`;

  // Plain tables go through the query builder; the view and the per-day coverage split
  // (generate_series) are raw SQL.
  const [protocolsInUse, eventTypeColumns, participantRows, measured, counts, coverage] = await Promise.all([
    db
      .select({
        versionLabel: protocolVersions.versionLabel,
        status: protocolVersions.status,
        publishedAt: protocolVersions.publishedAt,
        participantCount: sql<number>`count(distinct ${participantProtocols.participantId})::int`,
      })
      .from(participantProtocols)
      .innerJoin(participants, eq(participants.id, participantProtocols.participantId))
      .innerJoin(protocolVersions, eq(protocolVersions.id, participantProtocols.protocolVersionId))
      .where(sql`${eq(participants.studyId, study.id)} and ${currentAssignment}`)
      .groupBy(protocolVersions.id)
      .orderBy(sql`${protocolVersions.publishedAt} desc nulls last`),
    // Event types are grouped by key across protocol versions (the key is stable); the label comes
    // from the most recently published version that defines it.
    db
      .selectDistinctOn([eventTypes.key], { key: eventTypes.key, label: eventTypes.label })
      .from(eventTypes)
      .innerJoin(protocolVersions, eq(protocolVersions.id, eventTypes.protocolVersionId))
      .where(sql`${eq(protocolVersions.studyId, study.id)} and ${protocolVersions.status} <> 'draft'`)
      .orderBy(eventTypes.key, sql`${protocolVersions.publishedAt} desc nulls last`),
    db
      .select({
        id: participants.id,
        pseudonym: participants.pseudonym,
        status: participants.status,
        protocolLabel: protocolVersions.versionLabel,
      })
      .from(participants)
      .leftJoin(participantProtocols, sql`${eq(participantProtocols.participantId, participants.id)} and ${currentAssignment}`)
      .leftJoin(protocolVersions, eq(protocolVersions.id, participantProtocols.protocolVersionId))
      .where(eq(participants.studyId, study.id))
      .orderBy(participants.pseudonym),
    db
      .selectDistinct({ participantId: participantProtocols.participantId, key: eventTypes.key })
      .from(participantProtocols)
      .innerJoin(participants, eq(participants.id, participantProtocols.participantId))
      .innerJoin(eventTypes, eq(eventTypes.protocolVersionId, participantProtocols.protocolVersionId))
      .where(eq(participants.studyId, study.id)),
    db.execute<{ participantId: string; key: string; n: number }>(sql`
      select o.participant_id as "participantId", et.key, count(*)::int as n
      from v_current_observations o
      join participants p on p.id = o.participant_id
      join event_types et on et.id = o.event_type_id
      where p.study_id = ${study.id}
      group by 1, 2`),
    // Coverage per status and participant-local day, split at local midnights so each day adds up
    // even across midnight or a DST change. The study period of a participant runs from their first
    // protocol assignment to the end of the last one, now, or their withdrawal, whichever is first;
    // the part of it with no coverage row comes back as `no_record`.
    db.execute<{ participantId: string; day: string; status: CoverageStatus | NoRecord; seconds: number }>(sql`
      with period as (
        select p.id as participant_id,
               tstzrange(min(pp.valid_from), greatest(min(pp.valid_from), least(
                 max(coalesce(pp.valid_to, 'infinity')), now(), coalesce(p.withdrawn_at, 'infinity')))) as r
        from participants p
        join participant_protocols pp on pp.participant_id = p.id
        where p.study_id = ${study.id}
        group by p.id
      ),
      spans as (
        select c.participant_id, c.status, tstzrange(c.started_at, c.ended_at) as r
        from coverage_intervals c
        join participants p on p.id = c.participant_id
        where p.study_id = ${study.id}
      ),
      days as (
        select distinct x.participant_id, d.day,
               tstzrange(d.day at time zone p.timezone, (d.day + interval '1 day') at time zone p.timezone) as r
        from (select participant_id, r from spans union all select participant_id, r from period where not isempty(r)) x
        join participants p on p.id = x.participant_id
        cross join lateral generate_series(
          date_trunc('day', lower(x.r) at time zone p.timezone),
          (upper(x.r) - interval '1 microsecond') at time zone p.timezone,
          interval '1 day') as d(day)
      )
      select d.participant_id as "participantId", to_char(d.day, 'YYYY-MM-DD') as day, s.status,
             sum(extract(epoch from upper(s.r * d.r) - lower(s.r * d.r)))::float8 as seconds
      from days d
      join spans s on s.participant_id = d.participant_id and s.r && d.r
      group by 1, 2, 3
      union all
      select d.participant_id, to_char(d.day, 'YYYY-MM-DD'), 'no_record',
             (extract(epoch from upper(pe.r * d.r) - lower(pe.r * d.r))
               - coalesce(sum(extract(epoch from upper(s.r * d.r * pe.r) - lower(s.r * d.r * pe.r))), 0))::float8
      from days d
      join period pe on pe.participant_id = d.participant_id and pe.r && d.r
      left join spans s on s.participant_id = d.participant_id and s.r && (d.r * pe.r)
      group by d.participant_id, d.day, d.r, pe.r`),
  ]);

  const countsByParticipant = new Map<string, Record<string, number>>();
  for (const row of counts.rows) {
    const entry = countsByParticipant.get(row.participantId) ?? {};
    entry[row.key] = row.n;
    countsByParticipant.set(row.participantId, entry);
  }

  const measuredByParticipant = new Map<string, string[]>();
  for (const row of measured) {
    measuredByParticipant.set(row.participantId, [...(measuredByParticipant.get(row.participantId) ?? []), row.key]);
  }

  const coverageByParticipant = new Map<string, Map<string, StatusSeconds>>();
  for (const row of coverage.rows) {
    // Sub-second remainders of the no_record subtraction are float noise, not missing time.
    if (row.seconds < 1) continue;
    const byDay = coverageByParticipant.get(row.participantId) ?? new Map<string, StatusSeconds>();
    const byStatus = byDay.get(row.day) ?? new Map<CoverageStatus | NoRecord, number>();
    byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + row.seconds);
    byDay.set(row.day, byStatus);
    coverageByParticipant.set(row.participantId, byDay);
  }

  return {
    ...study,
    protocolsInUse,
    eventTypes: eventTypeColumns,
    participants: participantRows.map((p) => {
      const byDay = coverageByParticipant.get(p.id) ?? new Map<string, StatusSeconds>();
      const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, byStatus]) => ({ day, ...breakdown(byStatus) }));
      const total: StatusSeconds = new Map();
      for (const byStatus of byDay.values()) {
        for (const [status, seconds] of byStatus) total.set(status, (total.get(status) ?? 0) + seconds);
      }
      return {
        ...p,
        measuredEventKeys: measuredByParticipant.get(p.id) ?? [],
        observationCounts: countsByParticipant.get(p.id) ?? {},
        coverage: breakdown(total),
        days,
      };
    }),
  };
}

type StatusSeconds = Map<CoverageStatus | NoRecord, number>;

function breakdown(byStatus: StatusSeconds): CoverageBreakdown {
  let totalSeconds = 0;
  const notObserved: CoverageBreakdown["notObserved"] = [];
  for (const [status, seconds] of byStatus) {
    totalSeconds += seconds;
    if (status !== "observed") notObserved.push({ status, seconds });
  }
  notObserved.sort((a, b) => b.seconds - a.seconds);
  return { totalSeconds, observedSeconds: byStatus.get("observed") ?? 0, notObserved };
}
