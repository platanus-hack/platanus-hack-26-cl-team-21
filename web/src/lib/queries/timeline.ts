import { db, sql } from "@observatorio/db";
import { type CoverageBandStatus, type CoverageStatus, type NotObservedStatus, SENSOR_ORDER } from "@/lib/labels";
import { getStudyPeriod, type StudyPeriod, studyPeriods } from "./coverage";
import { getStudyByCode } from "./studies";

// Data for the participant timeline page: one row of coverage bands per local day (participant
// timezone) with the current observations on top, plus the per-day summary. Days and coverage use
// the shared study period (./coverage), so the totals match the overview and the observation
// list. Instants travel as
// epoch milliseconds (float8) so raw `sql` rows don't depend on the driver's timestamp parsing.
// Callers must `await connection()` before calling this.

/** `no_record`: a stretch of the study period with no coverage interval at all, so never "observed". */
export type BandStatus = CoverageBandStatus;

export type ProtocolAssignment = { label: string; fromMs: number; toMs: number | null };

export type DeviceAssignment = {
  serial: string;
  hardwareRevision: string;
  formFactor: string;
  fromMs: number;
  toMs: number | null;
  firmwareVersions: string[];
};

export type SensorStat = { sensorType: string; unit: string; n: number; mean: number | null; min: number | null; max: number | null };

export type TimelineObservation = {
  id: string;
  eventKey: string;
  eventLabel: string;
  startMs: number;
  endMs: number;
  attributes: Record<string, unknown>;
  confidence: number | null; // model output, not a calibrated probability
  reviewStatus: string; // pending | confirmed | corrected (rejected ones are hidden by the view)
  protocolVersion: string;
  modelVersion: string;
  pipelineVersion: string;
  evidenceCount: number;
  sensorContext: SensorStat[];
};

export type Band = { status: BandStatus; startMs: number; endMs: number; leftPct: number; widthPct: number };

export type PlacedObservation = TimelineObservation & {
  leftPct: number;
  widthPct: number;
  /** Milliseconds of the episode that fall in observed time (whole episode, not clipped to the day). */
  observedMs: number;
  /** Non-observed statuses the episode overlaps, if any (should not happen; surfaced, not hidden). */
  overlapsNotObserved: BandStatus[];
  /**
   * The instant that decides which local day lists and counts the episode: where its observed
   * time begins, or its start if none of it was observed. An episode crossing midnight from
   * unobserved into observed time belongs to the day where it was seen.
   */
  anchorMs: number;
};

/** `observedMs` sums only the observed part of each episode, so time that was not observed never inflates it. */
export type EventCount = { eventKey: string; eventLabel: string; count: number; observedMs: number };

export type DaySummary = {
  /** Part of the day inside the study period; 0 for a day outside it (listed only for its observations). */
  periodMs: number;
  observedMs: number;
  notObserved: { status: NotObservedStatus; ms: number }[];
  /** Episodes counted over observed time only (an episode counts if it overlaps observed time). */
  counts: EventCount[];
  /** Episodes listed this day that have no overlap with observed time: not counted. */
  uncounted: number;
};

export type TimelineDay = {
  day: string; // YYYY-MM-DD, participant's local day
  startMs: number;
  endMs: number;
  /** The part of the day inside the study period, or null if none of it is. Bands only cover this. */
  period: { startMs: number; endMs: number } | null;
  bands: Band[];
  /** Observations overlapping the day, positioned (clipped) on its bar. */
  markers: PlacedObservation[];
  /** Observations anchored to this day (see `anchorMs`): the list and the counts use these. */
  observations: PlacedObservation[];
  summary: DaySummary;
};

export type ParticipantTimeline = {
  participant: { id: string; pseudonym: string; status: string; timezone: string; arm: string | null };
  study: { code: string; title: string };
  /** Null when the participant has no protocol assignment. */
  period: StudyPeriod | null;
  protocols: ProtocolAssignment[];
  devices: DeviceAssignment[];
  runs: { modelVersion: string; pipelineVersion: string }[];
  days: TimelineDay[];
};

const epochMs = (column: string) => sql.raw(`(extract(epoch from ${column}) * 1000)::float8`);

export async function getParticipantTimeline(studyCode: string, pseudonym: string): Promise<ParticipantTimeline | null> {
  const study = await getStudyByCode(studyCode);
  if (!study) return null;
  const found = await db.execute<{ id: string; pseudonym: string; status: string; timezone: string; arm: string | null }>(sql`
    select p.id, p.pseudonym, p.status, p.timezone, p.arm
    from participants p
    where p.study_id = ${study.id} and p.pseudonym = ${pseudonym}`);
  const p = found.rows[0];
  if (!p) return null;

  const [period, protocols, devices, coverage, observations, sensorRows, days] = await Promise.all([
    getStudyPeriod(p.id),
    db.execute<ProtocolAssignment>(sql`
      select pv.version_label as "label", ${epochMs("pp.valid_from")} as "fromMs", ${epochMs("pp.valid_to")} as "toMs"
      from participant_protocols pp
      join protocol_versions pv on pv.id = pp.protocol_version_id
      where pp.participant_id = ${p.id}
      order by pp.valid_from`),
    // Firmware comes from what the device actually sent for this participant (sync batches, clips).
    db.execute<DeviceAssignment>(sql`
      select d.serial, d.hardware_revision as "hardwareRevision", d.form_factor as "formFactor",
             ${epochMs("da.valid_from")} as "fromMs", ${epochMs("da.valid_to")} as "toMs",
             coalesce((
               select array_agg(distinct f.v order by f.v) from (
                 select sb.firmware_version as v from sync_batches sb
                 where sb.device_id = d.id and sb.participant_id = da.participant_id
                 union
                 select m.firmware_version from media_assets m
                 where m.device_id = d.id and m.participant_id = da.participant_id
               ) f
             ), '{}') as "firmwareVersions"
      from device_assignments da
      join devices d on d.id = da.device_id
      where da.participant_id = ${p.id}
      order by da.valid_from`),
    db.execute<{ status: CoverageStatus; startMs: number; endMs: number }>(sql`
      select status, ${epochMs("started_at")} as "startMs", ${epochMs("ended_at")} as "endMs"
      from coverage_intervals
      where participant_id = ${p.id}
      order by started_at`),
    db.execute<Omit<TimelineObservation, "sensorContext">>(sql`
      select o.id, et.key as "eventKey", et.label as "eventLabel",
             ${epochMs("o.started_at")} as "startMs", ${epochMs("o.ended_at")} as "endMs",
             o.attributes, o.confidence::float8 as confidence, o.human_review_status as "reviewStatus",
             pv.version_label as "protocolVersion", pr.model_version as "modelVersion", pr.pipeline_version as "pipelineVersion",
             (select count(*)::int from observation_evidence ev where ev.observation_id = o.id) as "evidenceCount"
      from v_current_observations o
      join event_types et on et.id = o.event_type_id
      join pipeline_runs pr on pr.id = o.pipeline_run_id
      join protocol_versions pv on pv.id = pr.protocol_version_id
      where o.participant_id = ${p.id}
      order by o.started_at`),
    db.execute<SensorStat & { observationId: string }>(sql`
      select o.id as "observationId", s.sensor_type as "sensorType", s.unit, s.n::int as n,
             s.mean, s.min::float8 as min, s.max::float8 as max
      from v_current_observations o
      cross join lateral sensor_window_stats(o.participant_id, o.started_at, o.ended_at) s
      where o.participant_id = ${p.id}`),
    // Every local day of the study period (a day without data is fully "Sin registro"), plus any
    // day with an observation outside the period so no observation is hidden. Real bounds: DST
    // days are 23 h / 25 h long.
    db.execute<{ day: string; startMs: number; endMs: number }>(sql`
      with b as (
        select lower(r) as lo, upper(r) as hi from (${studyPeriods(sql`p.id = ${p.id}`)}) pe
        union all
        select started_at, greatest(ended_at, started_at + interval '1 microsecond')
        from v_current_observations where participant_id = ${p.id}
      )
      select distinct to_char(g.ts, 'YYYY-MM-DD') as "day",
             (extract(epoch from (g.ts at time zone ${p.timezone})) * 1000)::float8 as "startMs",
             (extract(epoch from ((g.ts + interval '1 day') at time zone ${p.timezone})) * 1000)::float8 as "endMs"
      from b
      cross join lateral generate_series(
        date_trunc('day', b.lo at time zone ${p.timezone}),
        (b.hi - interval '1 microsecond') at time zone ${p.timezone},
        interval '1 day') as g(ts)
      order by 1`),
  ]);

  const sensorsByObservation = new Map<string, SensorStat[]>();
  for (const { observationId, ...stat } of sensorRows.rows) {
    const list = sensorsByObservation.get(observationId) ?? [];
    list.push(stat);
    sensorsByObservation.set(observationId, list);
  }
  const allObservations: TimelineObservation[] = observations.rows.map((o) => ({
    ...o,
    attributes: (o.attributes ?? {}) as Record<string, unknown>,
    sensorContext: sortSensors(sensorsByObservation.get(o.id) ?? []),
  }));

  const runs = new Map<string, { modelVersion: string; pipelineVersion: string }>();
  for (const o of allObservations) runs.set(`${o.modelVersion}|${o.pipelineVersion}`, { modelVersion: o.modelVersion, pipelineVersion: o.pipelineVersion });

  return {
    participant: { id: p.id, pseudonym: p.pseudonym, status: p.status, timezone: p.timezone, arm: p.arm },
    study: { code: study.code, title: study.title },
    period,
    protocols: protocols.rows,
    devices: devices.rows,
    runs: [...runs.values()],
    days: days.rows.map((d) => buildDay(d, period, clipToPeriod(coverage.rows, period), allObservations)),
  };
}

type CoverageSpan = { status: CoverageStatus; startMs: number; endMs: number };

/** Coverage outside the study period is not counted anywhere (same rule as ./coverage). */
function clipToPeriod(coverage: CoverageSpan[], period: StudyPeriod | null): CoverageSpan[] {
  if (!period) return [];
  return coverage
    .map((c) => ({ ...c, startMs: Math.max(c.startMs, period.fromMs), endMs: Math.min(c.endMs, period.toMs) }))
    .filter((c) => c.endMs > c.startMs);
}

function sortSensors(stats: SensorStat[]) {
  const rank = (key: string) => (SENSOR_ORDER.includes(key) ? SENSOR_ORDER.indexOf(key) : SENSOR_ORDER.length);
  return stats.sort((a, b) => rank(a.sensorType) - rank(b.sensorType) || a.sensorType.localeCompare(b.sensorType));
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/** Whether [a0, a1) touches [b0, b1); a zero-length episode counts if its instant is inside. */
const touches = (a0: number, a1: number, b0: number, b1: number) => (a1 > a0 ? a0 < b1 && b0 < a1 : a0 >= b0 && a0 < b1);

/** `coverage` must already be clipped to `period`. */
export function buildDay(
  day: { day: string; startMs: number; endMs: number },
  period: StudyPeriod | null,
  coverage: CoverageSpan[],
  observations: TimelineObservation[],
): TimelineDay {
  const { startMs, endMs } = day;
  const dayMs = endMs - startMs;
  const pct = (ms: number) => ((ms - startMs) / dayMs) * 100;
  const periodStartMs = Math.max(startMs, period?.fromMs ?? Infinity);
  const periodEndMs = Math.min(endMs, period?.toMs ?? -Infinity);
  const inPeriod = periodEndMs > periodStartMs ? { startMs: periodStartMs, endMs: periodEndMs } : null;

  // Coverage clipped to the day; any stretch of the study period without an interval becomes an
  // explicit "no_record". Time outside the period gets no band. Touching intervals with the same
  // status (e.g. consecutive observed segments) merge into one band.
  const bands: Band[] = [];
  let cursor = inPeriod?.startMs ?? endMs;
  const push = (status: BandStatus, from: number, to: number) => {
    if (to <= from) return;
    const last = bands.at(-1);
    if (last && last.status === status && last.endMs === from) {
      last.endMs = to;
      last.widthPct = pct(to) - last.leftPct;
    } else {
      bands.push({ status, startMs: from, endMs: to, leftPct: pct(from), widthPct: pct(to) - pct(from) });
    }
  };
  for (const c of coverage) {
    const from = Math.max(c.startMs, startMs);
    const to = Math.min(c.endMs, endMs);
    if (to <= from) continue;
    push("no_record", cursor, from);
    push(c.status, from, to);
    cursor = Math.max(cursor, to);
  }
  if (inPeriod) push("no_record", cursor, inPeriod.endMs);

  // Coverage over the whole timeline (not just this day) decides whether an episode was observed.
  const place = (o: TimelineObservation): PlacedObservation => {
    const from = Math.max(o.startMs, startMs);
    const to = Math.min(o.endMs, endMs);
    let observedMs = 0;
    let firstObservedMs = Infinity;
    const others = new Set<BandStatus>();
    let coveredMs = 0;
    for (const c of coverage) {
      if (!touches(o.startMs, o.endMs, c.startMs, c.endMs)) continue;
      const ms = overlap(o.startMs, o.endMs, c.startMs, c.endMs);
      coveredMs += ms;
      if (c.status === "observed") {
        observedMs += o.endMs > o.startMs ? ms : 1;
        firstObservedMs = Math.min(firstObservedMs, Math.max(o.startMs, c.startMs));
      } else others.add(c.status);
    }
    if (o.endMs > o.startMs && coveredMs < o.endMs - o.startMs) others.add("no_record");
    if (o.endMs === o.startMs && observedMs === 0 && others.size === 0) others.add("no_record");
    const anchorMs = observedMs > 0 ? firstObservedMs : o.startMs;
    return { ...o, leftPct: pct(from), widthPct: pct(to) - pct(from), observedMs, overlapsNotObserved: [...others], anchorMs };
  };

  const markers = observations.filter((o) => touches(o.startMs, o.endMs, startMs, endMs)).map(place);
  const own = markers.filter((o) => o.anchorMs >= startMs && o.anchorMs < endMs);

  const byStatus = new Map<BandStatus, number>();
  for (const b of bands) byStatus.set(b.status, (byStatus.get(b.status) ?? 0) + (b.endMs - b.startMs));
  const notObserved = [...byStatus.entries()]
    .filter((e): e is [NotObservedStatus, number] => e[0] !== "observed")
    .map(([status, ms]) => ({ status, ms }))
    .sort((a, b) => b.ms - a.ms);

  const counts = new Map<string, EventCount>();
  let uncounted = 0;
  for (const o of own) {
    if (o.observedMs <= 0) {
      uncounted++;
      continue;
    }
    const entry = counts.get(o.eventKey) ?? { eventKey: o.eventKey, eventLabel: o.eventLabel, count: 0, observedMs: 0 };
    entry.count++;
    entry.observedMs += o.observedMs;
    counts.set(o.eventKey, entry);
  }

  return {
    day: day.day,
    startMs,
    endMs,
    period: inPeriod,
    bands,
    markers,
    observations: own,
    summary: {
      periodMs: inPeriod ? inPeriod.endMs - inPeriod.startMs : 0,
      observedMs: byStatus.get("observed") ?? 0,
      notObserved,
      counts: [...counts.values()].sort((a, b) => a.eventKey.localeCompare(b.eventKey)),
      uncounted,
    },
  };
}
