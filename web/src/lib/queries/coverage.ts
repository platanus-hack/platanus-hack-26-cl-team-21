import { db, sql } from "@observatorio/db";
import type { CoverageBandStatus, NotObservedStatus } from "@/lib/labels";

// The one definition of a participant's study period and of the coverage inside it, used by the
// study overview, the observation-list coverage note and the participant timeline so their totals
// agree. Callers must `await connection()` first.
//
// A participant's study period runs from their first protocol assignment
// (participant_protocols.valid_from) to the end of their last assignment, their withdrawal or now,
// whichever comes first. A participant with no assignment has no period. Coverage is clipped to
// the period, and period time without any coverage_intervals row is `no_record` ("Sin registro"):
// not observed, never a zero.

type SQL = ReturnType<typeof sql>;

/**
 * `select participant_id, timezone, r` with one row per participant matching `participantWhere`
 * (a condition on alias `p`) that has a non-empty study period `r` (tstzrange). Meant to be used
 * as a CTE or subquery.
 */
export function studyPeriods(participantWhere: SQL): SQL {
  return sql`
    select participant_id, timezone, r from (
      select p.id as participant_id, p.timezone,
             tstzrange(min(pp.valid_from), greatest(min(pp.valid_from), least(
               max(coalesce(pp.valid_to, 'infinity')), now(), coalesce(p.withdrawn_at, 'infinity')))) as r
      from participants p
      join participant_protocols pp on pp.participant_id = p.id
      where ${participantWhere}
      group by p.id
    ) periods
    where not isempty(r)`;
}

/**
 * Condition that the observation row aliased `alias` overlaps observed time inside its
 * participant's study period: the rule for whether an episode is counted (the timeline's
 * `observedMs > 0`). A zero-length episode counts if its instant falls in observed time.
 */
export function inObservedTime(alias: string): SQL {
  const o = sql.raw(alias);
  return sql`exists (
    select 1
    from coverage_intervals c
    join (${studyPeriods(sql`p.id = ${o}.participant_id`)}) pe on pe.participant_id = c.participant_id
    where c.participant_id = ${o}.participant_id
      and c.status = 'observed'
      and tstzrange(c.started_at, c.ended_at) * pe.r
          && case when ${o}.ended_at > ${o}.started_at then tstzrange(${o}.started_at, ${o}.ended_at)
                  else tstzrange(${o}.started_at, ${o}.started_at, '[]') end)`;
}

export type StudyPeriod = {
  fromMs: number;
  toMs: number;
  /** The period is still running: it ends now, not at an assignment end or a withdrawal. */
  ongoing: boolean;
};

export async function getStudyPeriod(participantId: string): Promise<StudyPeriod | null> {
  const result = await db.execute<StudyPeriod>(sql`
    select (extract(epoch from lower(r)) * 1000)::float8 as "fromMs", (extract(epoch from upper(r)) * 1000)::float8 as "toMs",
           upper(r) = now() as ongoing
    from (${studyPeriods(sql`p.id = ${participantId}`)}) pe`);
  return result.rows[0] ?? null;
}

export type CoverageDayRow = {
  participantId: string;
  /** Participant-local day, YYYY-MM-DD. */
  day: string;
  status: CoverageBandStatus;
  seconds: number;
};

/**
 * Seconds per coverage status (plus `no_record`) and participant-local day, inside the study
 * period of each participant matching `participantWhere` (a condition on alias `p`). Days are split
 * at local midnights, so each day adds up even across midnight or a DST change. With `day`, only
 * that local day is returned.
 */
export async function getCoverageByDay(participantWhere: SQL, day?: string): Promise<CoverageDayRow[]> {
  const result = await db.execute<CoverageDayRow>(sql`
    with period as (${studyPeriods(participantWhere)}),
    spans as (
      select c.participant_id, c.status, tstzrange(c.started_at, c.ended_at) * pe.r as r
      from coverage_intervals c
      join period pe on pe.participant_id = c.participant_id and tstzrange(c.started_at, c.ended_at) && pe.r
    ),
    days as (
      select pe.participant_id, d.day,
             tstzrange(d.day at time zone pe.timezone, (d.day + interval '1 day') at time zone pe.timezone) * pe.r as r
      from period pe
      cross join lateral generate_series(
        date_trunc('day', lower(pe.r) at time zone pe.timezone),
        (upper(pe.r) - interval '1 microsecond') at time zone pe.timezone,
        interval '1 day') as d(day)
      ${day ? sql`where d.day = ${day}::date::timestamp` : sql``}
    )
    select d.participant_id as "participantId", to_char(d.day, 'YYYY-MM-DD') as day, s.status,
           sum(extract(epoch from upper(s.r * d.r) - lower(s.r * d.r)))::float8 as seconds
    from days d
    join spans s on s.participant_id = d.participant_id and s.r && d.r
    group by 1, 2, 3
    union all
    select d.participant_id, to_char(d.day, 'YYYY-MM-DD'), 'no_record',
           (extract(epoch from upper(d.r) - lower(d.r))
             - coalesce(sum(extract(epoch from upper(s.r * d.r) - lower(s.r * d.r))), 0))::float8
    from days d
    left join spans s on s.participant_id = d.participant_id and s.r && d.r
    group by d.participant_id, d.day, d.r`);
  // Sub-second remainders of the no_record subtraction are float noise, not missing time.
  return result.rows.filter((row) => row.seconds >= 1);
}

/** Coverage of some stretch of study-period time. Only statuses that actually occur are listed. */
export type CoverageBreakdown = {
  totalSeconds: number;
  observedSeconds: number;
  /** Largest first. */
  notObserved: { status: NotObservedStatus; seconds: number }[];
};

export function summarizeCoverage(rows: { status: CoverageBandStatus; seconds: number }[]): CoverageBreakdown {
  const byStatus = new Map<CoverageBandStatus, number>();
  for (const row of rows) byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + row.seconds);
  let totalSeconds = 0;
  const notObserved: CoverageBreakdown["notObserved"] = [];
  for (const [status, seconds] of byStatus) {
    totalSeconds += seconds;
    if (status !== "observed") notObserved.push({ status, seconds });
  }
  notObserved.sort((a, b) => b.seconds - a.seconds);
  return { totalSeconds, observedSeconds: byStatus.get("observed") ?? 0, notObserved };
}
