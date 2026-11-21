import { COVERAGE_STATUS, db, eq, sql, studies } from "@observatorio/db";

type SQL = ReturnType<typeof sql>;

// Read-side queries for the study observation list. Observations always come from
// v_current_observations (not superseded, latest human review applied, rejected hidden).
// Callers must `await connection()` before using them.

export type CoverageStatus = (typeof COVERAGE_STATUS)[number];

// Review statuses that can appear in v_current_observations ('rejected' rows are hidden by the view).
export const VISIBLE_REVIEW_STATUSES = ["pending", "confirmed", "corrected"] as const;
export type VisibleReviewStatus = (typeof VISIBLE_REVIEW_STATUSES)[number];

export type ObservationFilters = {
  participant?: string; // pseudonym
  eventType?: string; // event_types.key, stable across protocol versions
  reviewStatus?: VisibleReviewStatus;
  date?: string; // YYYY-MM-DD, the participant's local day
};

export type StudyRef = { id: string; code: string; title: string };

export async function findStudyByCode(code: string): Promise<StudyRef | null> {
  const [study] = await db
    .select({ id: studies.id, code: studies.code, title: studies.title })
    .from(studies)
    .where(eq(studies.code, code));
  return study ?? null;
}

export type FilterOptions = {
  participants: { pseudonym: string; timezone: string }[];
  eventTypes: { key: string; label: string }[];
  dates: string[];
};

export async function getObservationFilterOptions(studyId: string): Promise<FilterOptions> {
  const [participantRows, eventTypeRows, dateRows] = await Promise.all([
    db.execute<{ pseudonym: string; timezone: string }>(sql`
      select pseudonym, timezone from participants where study_id = ${studyId} order by pseudonym`),
    db.execute<{ key: string; label: string }>(sql`
      select distinct on (et.key) et.key, et.label
      from event_types et
      join protocol_versions pv on pv.id = et.protocol_version_id
      where pv.study_id = ${studyId}
      order by et.key, pv.created_at desc`),
    // Local days with any coverage record or observation, in each participant's time zone.
    db.execute<{ day: string }>(sql`
      select distinct to_char(t at time zone p.timezone, 'YYYY-MM-DD') as day
      from participants p
      cross join lateral (
        select c.started_at from coverage_intervals c where c.participant_id = p.id
        union all
        select c.ended_at - interval '1 microsecond' from coverage_intervals c where c.participant_id = p.id
        union all
        select o.started_at from v_current_observations o where o.participant_id = p.id
      ) x(t)
      where p.study_id = ${studyId}
      order by day`),
  ]);
  return {
    participants: participantRows.rows,
    eventTypes: eventTypeRows.rows,
    dates: dateRows.rows.map((row) => row.day),
  };
}

export type ObservationRow = {
  id: string;
  pseudonym: string;
  timezone: string;
  event_type_key: string;
  event_type_label: string;
  local_date: string;
  local_start: string;
  local_end_date: string;
  local_end: string;
  duration_s: number;
  attributes: Record<string, unknown>;
  confidence: number | null;
  human_review_status: VisibleReviewStatus;
  model_name: string;
  model_version: string;
  pipeline_version: string;
  protocol_version: string;
};

function participantScope(studyId: string, filters: ObservationFilters): SQL {
  const conditions = [sql`p.study_id = ${studyId}`];
  if (filters.participant) conditions.push(sql`p.pseudonym = ${filters.participant}`);
  return sql.join(conditions, sql` and `);
}

// Start and end of the participant's local day `date` as timestamptz.
const localDayStart = (date: string) => sql`(${date}::date::timestamp at time zone p.timezone)`;
const localDayEnd = (date: string) => sql`((${date}::date + 1)::timestamp at time zone p.timezone)`;

export async function listObservations(studyId: string, filters: ObservationFilters): Promise<ObservationRow[]> {
  const conditions = [participantScope(studyId, filters)];
  if (filters.eventType) conditions.push(sql`et.key = ${filters.eventType}`);
  if (filters.reviewStatus) conditions.push(sql`o.human_review_status = ${filters.reviewStatus}`);
  if (filters.date) {
    conditions.push(sql`o.started_at >= ${localDayStart(filters.date)} and o.started_at < ${localDayEnd(filters.date)}`);
  }

  const result = await db.execute<ObservationRow>(sql`
    select o.id,
           p.pseudonym,
           p.timezone,
           et.key as event_type_key,
           et.label as event_type_label,
           to_char(o.started_at at time zone p.timezone, 'YYYY-MM-DD') as local_date,
           to_char(o.started_at at time zone p.timezone, 'HH24:MI') as local_start,
           to_char(o.ended_at at time zone p.timezone, 'YYYY-MM-DD') as local_end_date,
           to_char(o.ended_at at time zone p.timezone, 'HH24:MI') as local_end,
           extract(epoch from o.ended_at - o.started_at)::int as duration_s,
           o.attributes,
           o.confidence,
           o.human_review_status,
           r.model_name,
           r.model_version,
           r.pipeline_version,
           pv.version_label as protocol_version
    from v_current_observations o
    join participants p on p.id = o.participant_id
    join event_types et on et.id = o.event_type_id
    join pipeline_runs r on r.id = o.pipeline_run_id
    join protocol_versions pv on pv.id = r.protocol_version_id
    where ${sql.join(conditions, sql` and `)}
    order by o.started_at, p.pseudonym`);
  return result.rows;
}

export type CoverageSummary = {
  // Seconds per coverage status inside the scope, clipped to the selected day when there is one.
  byStatus: Record<CoverageStatus, number>;
  // Seconds in the scope with no coverage record at all: unknown, so also not observed.
  unrecordedSeconds: number;
  totalSeconds: number;
  participantCount: number;
  // Participants in scope without any coverage record (only possible without a date filter): their
  // time can't be measured, so it is not part of totalSeconds and must be reported separately.
  participantsWithoutCoverage: number;
};

// Coverage depends on who and when, not on event type or review status. The scope is each
// participant's local day when a date is selected; otherwise the span from their first to their
// last coverage record, so a participant with no records at all adds no time and is counted apart.
export async function getCoverageSummary(studyId: string, filters: ObservationFilters): Promise<CoverageSummary> {
  const window = filters.date
    ? sql`${localDayStart(filters.date)} as w_from, ${localDayEnd(filters.date)} as w_to`
    : sql`span.w_from, span.w_to`;

  const result = await db.execute<{ status: CoverageStatus | null; seconds: number; total_seconds: number; participant_count: number; without_coverage: number }>(sql`
    with scope as (
      select p.id, ${window}
      from participants p
      left join lateral (
        select min(c.started_at) as w_from, max(c.ended_at) as w_to
        from coverage_intervals c where c.participant_id = p.id
      ) span on true
      where ${participantScope(studyId, filters)}
    ),
    clipped as (
      select c.status,
             extract(epoch from least(c.ended_at, s.w_to) - greatest(c.started_at, s.w_from)) as seconds
      from scope s
      join coverage_intervals c on c.participant_id = s.id
       and c.ended_at > s.w_from and c.started_at < s.w_to
    ),
    totals as (
      select coalesce(sum(extract(epoch from w_to - w_from)), 0)::float8 as total_seconds,
             count(*)::int as participant_count,
             (count(*) filter (where w_from is null))::int as without_coverage
      from scope
    )
    select g.status, g.seconds, t.total_seconds, t.participant_count, t.without_coverage
    from totals t
    left join (select status, sum(seconds)::float8 as seconds from clipped group by status) g on true`);

  const byStatus = Object.fromEntries(COVERAGE_STATUS.map((status) => [status, 0])) as Record<CoverageStatus, number>;
  let recorded = 0;
  for (const row of result.rows) {
    if (!row.status) continue;
    byStatus[row.status] = row.seconds;
    recorded += row.seconds;
  }
  const totalSeconds = result.rows[0]?.total_seconds ?? 0;
  return {
    byStatus,
    unrecordedSeconds: Math.max(0, totalSeconds - recorded),
    totalSeconds,
    participantCount: result.rows[0]?.participant_count ?? 0,
    participantsWithoutCoverage: result.rows[0]?.without_coverage ?? 0,
  };
}
