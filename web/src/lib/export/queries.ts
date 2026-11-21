import { db, eq, exports, participants, researchers, sql, studies } from "@observatorio/db";
import type { ExportFilters, ExportParams } from "./params";

// Read side of the export feature. Observations always come from v_current_observations (not
// superseded, latest human review applied, rejected ones hidden). Instants travel as epoch
// milliseconds (float8) so raw rows don't depend on the driver's timestamp parsing; `real`
// columns go through numeric so 0.86 stays 0.86 instead of 0.8600000143051147.
// Callers must `await connection()` first.

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ExportStudy = { id: string; code: string; title: string; createdBy: string };

export async function findExportStudy(code: string): Promise<ExportStudy | null> {
  const [study] = await db
    .select({ id: studies.id, code: studies.code, title: studies.title, createdBy: studies.createdBy })
    .from(studies)
    .where(eq(studies.code, code));
  return study ?? null;
}

export async function listParticipantPseudonyms(studyId: string): Promise<string[]> {
  const rows = await db
    .select({ pseudonym: participants.pseudonym })
    .from(participants)
    .where(eq(participants.studyId, studyId))
    .orderBy(participants.pseudonym);
  return rows.map((row) => row.pseudonym);
}

export type ExportHistoryItem = {
  id: string;
  createdAt: Date;
  requestedBy: string;
  format: string;
  status: string;
  params: ExportParams;
  sha256: string | null;
};

export async function listStudyExports(studyId: string, limit = 50): Promise<ExportHistoryItem[]> {
  const rows = await db
    .select({
      id: exports.id,
      createdAt: exports.createdAt,
      requestedBy: researchers.fullName,
      format: exports.format,
      status: exports.status,
      params: exports.params,
      sha256: exports.sha256,
    })
    .from(exports)
    .innerJoin(researchers, eq(researchers.id, exports.requestedBy))
    .where(eq(exports.studyId, studyId))
    .orderBy(sql`${exports.createdAt} desc`)
    .limit(limit);
  return rows.map((row) => ({ ...row, params: row.params as ExportParams }));
}

type SQL = ReturnType<typeof sql>;

// Bounds of the participant's local day as timestamptz (p = participants row in the query).
const localDayStart = (day: string) => sql`(${day}::date::timestamp at time zone p.timezone)`;
const localDayEnd = (day: string) => sql`((${day}::date + 1)::timestamp at time zone p.timezone)`;

function participantScope(studyId: string, filters: ExportFilters): SQL[] {
  const conditions = [sql`p.study_id = ${studyId}`];
  if (filters.participant) conditions.push(sql`p.pseudonym = ${filters.participant}`);
  return conditions;
}

export type EvidenceRef = { clip_id: string; source_sha256: string; start_second: number; end_second: number };

export type ObservationExportRow = {
  id: string;
  pseudonym: string;
  timezone: string;
  event_type: string;
  started_ms: number;
  ended_ms: number;
  attributes: Record<string, unknown>;
  confidence: number | null; // model output, not a calibrated probability
  human_review_status: string;
  reviewed_ms: number | null;
  protocol_version: string;
  model_provider: string;
  model_name: string;
  model_version: string;
  pipeline_version: string;
  pipeline_run_id: string;
  device_serials: string[];
  firmware_versions: string[];
  evidence: EvidenceRef[];
};

// One row per current observation. A date range keeps observations that start inside it, like the
// observation list does.
export async function selectObservations(tx: Tx, studyId: string, filters: ExportFilters): Promise<ObservationExportRow[]> {
  const conditions = participantScope(studyId, filters);
  if (filters.dateFrom) conditions.push(sql`o.started_at >= ${localDayStart(filters.dateFrom)}`);
  if (filters.dateTo) conditions.push(sql`o.started_at < ${localDayEnd(filters.dateTo)}`);

  const result = await tx.execute<ObservationExportRow>(sql`
    select o.id,
           p.pseudonym,
           p.timezone,
           et.key as event_type,
           (extract(epoch from o.started_at) * 1000)::float8 as started_ms,
           (extract(epoch from o.ended_at) * 1000)::float8 as ended_ms,
           o.attributes,
           o.confidence::numeric::float8 as confidence,
           o.human_review_status,
           (extract(epoch from o.reviewed_at) * 1000)::float8 as reviewed_ms,
           pv.version_label as protocol_version,
           r.model_provider,
           r.model_name,
           r.model_version,
           r.pipeline_version,
           r.id as pipeline_run_id,
           coalesce(ev.device_serials, '{}') as device_serials,
           coalesce(ev.firmware_versions, '{}') as firmware_versions,
           coalesce(ev.evidence, '[]'::jsonb) as evidence
    from v_current_observations o
    join participants p on p.id = o.participant_id
    join event_types et on et.id = o.event_type_id
    join pipeline_runs r on r.id = o.pipeline_run_id
    join protocol_versions pv on pv.id = r.protocol_version_id
    left join lateral (
      select array_agg(distinct d.serial order by d.serial) as device_serials,
             array_agg(distinct m.firmware_version order by m.firmware_version) as firmware_versions,
             jsonb_agg(jsonb_build_object(
               'clip_id', m.id,
               'source_sha256', m.sha256,
               'start_second', e.start_second::numeric,
               'end_second', e.end_second::numeric
             ) order by m.recorded_from, e.start_second) as evidence
      from observation_evidence e
      join media_assets m on m.id = e.media_asset_id
      join devices d on d.id = m.device_id
      where e.observation_id = o.id
    ) ev on true
    where ${sql.join(conditions, sql` and `)}
    order by p.pseudonym, o.started_at, o.id`);
  return result.rows;
}

export type CoverageExportRow = {
  id: string;
  pseudonym: string;
  timezone: string;
  started_ms: number;
  ended_ms: number;
  status: string;
  source: string;
  device_serial: string | null;
  firmware_version: string | null;
  batch_id: string | null;
};

// Coverage intervals exactly as stored: no merging or clipping. A date range keeps every interval
// that overlaps it, whole.
export async function selectCoverage(tx: Tx, studyId: string, filters: ExportFilters): Promise<CoverageExportRow[]> {
  const conditions = participantScope(studyId, filters);
  if (filters.dateFrom) conditions.push(sql`c.ended_at > ${localDayStart(filters.dateFrom)}`);
  if (filters.dateTo) conditions.push(sql`c.started_at < ${localDayEnd(filters.dateTo)}`);

  const result = await tx.execute<CoverageExportRow>(sql`
    select c.id,
           p.pseudonym,
           p.timezone,
           (extract(epoch from c.started_at) * 1000)::float8 as started_ms,
           (extract(epoch from c.ended_at) * 1000)::float8 as ended_ms,
           c.status,
           c.source,
           d.serial as device_serial,
           sb.firmware_version,
           c.batch_id
    from coverage_intervals c
    join participants p on p.id = c.participant_id
    left join devices d on d.id = c.device_id
    left join sync_batches sb on sb.id = c.batch_id
    where ${sql.join(conditions, sql` and `)}
    order by p.pseudonym, c.started_at`);
  return result.rows;
}
