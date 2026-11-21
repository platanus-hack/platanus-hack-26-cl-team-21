import { db, sql } from "@observatorio/db";
import type { VisibleReviewStatus } from "@/lib/labels";
import { type CoverageBreakdown, getCoverageByDay, inObservedTime, studyPeriods, summarizeCoverage } from "./coverage";

type SQL = ReturnType<typeof sql>;

// Read-side queries for the study observation list. Observations always come from
// v_current_observations (not superseded, latest human review applied, rejected hidden).
// Callers must `await connection()` before using them.

export type ObservationFilters = {
  participant?: string; // pseudonym
  eventType?: string; // event_types.key, stable across protocol versions
  reviewStatus?: VisibleReviewStatus;
  date?: string; // YYYY-MM-DD, the participant's local day
};

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
    // Local days inside any participant's study period or with an observation, in each
    // participant's time zone.
    db.execute<{ day: string }>(sql`
      select to_char(d.day, 'YYYY-MM-DD') as day
      from (${studyPeriods(sql`p.study_id = ${studyId}`)}) pe
      cross join lateral generate_series(
        date_trunc('day', lower(pe.r) at time zone pe.timezone),
        (upper(pe.r) - interval '1 microsecond') at time zone pe.timezone,
        interval '1 day') as d(day)
      union
      select to_char(o.started_at at time zone p.timezone, 'YYYY-MM-DD')
      from v_current_observations o
      join participants p on p.id = o.participant_id
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
  /** Overlaps observed time in the study period, so it counts (same rule as the overview and timeline). */
  in_observed_time: boolean;
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
           pv.version_label as protocol_version,
           ${inObservedTime("o")} as in_observed_time
    from v_current_observations o
    join participants p on p.id = o.participant_id
    join event_types et on et.id = o.event_type_id
    join pipeline_runs r on r.id = o.pipeline_run_id
    join protocol_versions pv on pv.id = r.protocol_version_id
    where ${sql.join(conditions, sql` and `)}
    order by o.started_at, p.pseudonym`);
  return result.rows;
}

export type CoverageSummary = CoverageBreakdown & {
  participantCount: number;
  // Participants in scope without any protocol assignment have no study period: their time can't
  // be measured, so it is not part of the totals and is reported separately.
  participantsWithoutPeriod: number;
};

// Coverage depends on who and when, not on event type or review status. The scope is each
// participant's study period (see ./coverage), restricted to their local day when a date is selected.
export async function getCoverageSummary(studyId: string, filters: ObservationFilters): Promise<CoverageSummary> {
  const scope = participantScope(studyId, filters);
  const [rows, counts] = await Promise.all([
    getCoverageByDay(scope, filters.date),
    db.execute<{ participant_count: number; without_period: number }>(sql`
      select count(*)::int as participant_count,
             (count(*) filter (where p.id not in (select participant_id from (${studyPeriods(scope)}) pe)))::int as without_period
      from participants p
      where ${scope}`),
  ]);
  return {
    ...summarizeCoverage(rows),
    participantCount: counts.rows[0]?.participant_count ?? 0,
    participantsWithoutPeriod: counts.rows[0]?.without_period ?? 0,
  };
}
