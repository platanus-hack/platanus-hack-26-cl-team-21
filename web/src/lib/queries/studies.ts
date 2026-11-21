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
export type NotObservedStatus = Exclude<CoverageStatus, "observed">;

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

/** Seconds per coverage status. Only statuses that actually occur are present. */
export type CoverageBreakdown = {
  totalSeconds: number;
  observedSeconds: number;
  notObserved: { status: NotObservedStatus; seconds: number }[];
};

export type ParticipantOverview = {
  id: string;
  pseudonym: string;
  status: string;
  protocolLabel: string | null;
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
  const [protocolsInUse, eventTypeColumns, participantRows, counts, coverage] = await Promise.all([
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
    db.execute<{ participantId: string; key: string; n: number }>(sql`
      select o.participant_id as "participantId", et.key, count(*)::int as n
      from v_current_observations o
      join participants p on p.id = o.participant_id
      join event_types et on et.id = o.event_type_id
      where p.study_id = ${study.id}
      group by 1, 2`),
    // Coverage intervals split at the participant's local midnights, so each day adds up exactly
    // even when an interval crosses midnight or a DST change.
    db.execute<{ participantId: string; day: string; status: CoverageStatus; seconds: number }>(sql`
      select c.participant_id as "participantId",
             to_char(d.day, 'YYYY-MM-DD') as day,
             c.status,
             sum(extract(epoch from
               least(c.ended_at, (d.day + interval '1 day') at time zone p.timezone)
               - greatest(c.started_at, d.day at time zone p.timezone)))::float8 as seconds
      from coverage_intervals c
      join participants p on p.id = c.participant_id
      cross join lateral generate_series(
        date_trunc('day', c.started_at at time zone p.timezone),
        (c.ended_at - interval '1 microsecond') at time zone p.timezone,
        interval '1 day') as d(day)
      where p.study_id = ${study.id}
      group by 1, 2, 3`),
  ]);

  const countsByParticipant = new Map<string, Record<string, number>>();
  for (const row of counts.rows) {
    const entry = countsByParticipant.get(row.participantId) ?? {};
    entry[row.key] = row.n;
    countsByParticipant.set(row.participantId, entry);
  }

  const coverageByParticipant = new Map<string, Map<string, Map<CoverageStatus, number>>>();
  for (const row of coverage.rows) {
    const byDay = coverageByParticipant.get(row.participantId) ?? new Map<string, Map<CoverageStatus, number>>();
    const byStatus = byDay.get(row.day) ?? new Map<CoverageStatus, number>();
    byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + row.seconds);
    byDay.set(row.day, byStatus);
    coverageByParticipant.set(row.participantId, byDay);
  }

  return {
    ...study,
    protocolsInUse,
    eventTypes: eventTypeColumns,
    participants: participantRows.map((p) => {
      const byDay = coverageByParticipant.get(p.id) ?? new Map<string, Map<CoverageStatus, number>>();
      const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, byStatus]) => ({ day, ...breakdown(byStatus) }));
      const total = new Map<CoverageStatus, number>();
      for (const byStatus of byDay.values()) {
        for (const [status, seconds] of byStatus) total.set(status, (total.get(status) ?? 0) + seconds);
      }
      return {
        ...p,
        observationCounts: countsByParticipant.get(p.id) ?? {},
        coverage: breakdown(total),
        days,
      };
    }),
  };
}

function breakdown(byStatus: Map<CoverageStatus, number>): CoverageBreakdown {
  let totalSeconds = 0;
  const notObserved: CoverageBreakdown["notObserved"] = [];
  for (const [status, seconds] of byStatus) {
    totalSeconds += seconds;
    if (status !== "observed") notObserved.push({ status, seconds });
  }
  notObserved.sort((a, b) => b.seconds - a.seconds);
  return { totalSeconds, observedSeconds: byStatus.get("observed") ?? 0, notObserved };
}
