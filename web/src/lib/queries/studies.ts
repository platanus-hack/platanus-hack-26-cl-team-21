import { cache } from "react";
import { db, eq, participants, sql, studies, type COVERAGE_STATUS } from "@observatorio/db";

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

  const [protocolsInUse, eventTypes, participantRows, counts, coverage] = await Promise.all([
    // Raw queries return timestamptz as text (drizzle's node-postgres parser), so instants are
    // selected as epoch milliseconds.
    db.execute<Omit<ProtocolInUse, "publishedAt"> & { publishedAtMs: number | null }>(sql`
      select pv.version_label as "versionLabel", pv.status,
             (extract(epoch from pv.published_at) * 1000)::float8 as "publishedAtMs",
             count(distinct pp.participant_id)::int as "participantCount"
      from participant_protocols pp
      join participants p on p.id = pp.participant_id
      join protocol_versions pv on pv.id = pp.protocol_version_id
      where p.study_id = ${study.id}
        and pp.valid_from <= now() and (pp.valid_to is null or pp.valid_to > now())
      group by pv.id
      order by pv.published_at desc nulls last`),
    // Event types are grouped by key across protocol versions (the key is stable); the label comes
    // from the most recently published version that defines it.
    db.execute<EventTypeColumn>(sql`
      select key, label from (
        select distinct on (et.key) et.key, et.label
        from event_types et
        join protocol_versions pv on pv.id = et.protocol_version_id
        where pv.study_id = ${study.id} and pv.status <> 'draft'
        order by et.key, pv.published_at desc nulls last
      ) t
      order by key`),
    db.execute<{ id: string; pseudonym: string; status: string; protocolLabel: string | null }>(sql`
      select p.id, p.pseudonym, p.status, pv.version_label as "protocolLabel"
      from participants p
      left join participant_protocols pp on pp.participant_id = p.id
        and pp.valid_from <= now() and (pp.valid_to is null or pp.valid_to > now())
      left join protocol_versions pv on pv.id = pp.protocol_version_id
      where p.study_id = ${study.id}
      order by p.pseudonym`),
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
    protocolsInUse: protocolsInUse.rows.map(({ publishedAtMs, ...protocol }) => ({
      ...protocol,
      publishedAt: publishedAtMs === null ? null : new Date(publishedAtMs),
    })),
    eventTypes: eventTypes.rows,
    participants: participantRows.rows.map((p) => {
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
