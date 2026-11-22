import { auditLog, db, sql } from "@observatorio/db";
import { clipKey, createStorage } from "@observatorio/storage";

// Read model of one observation and the footage behind it. Unlike the list, it reads the tables (not
// v_current_observations) so a rejected or superseded observation can still be opened and explained.
// Callers must `await connection()` first.

export type EvidenceCut = {
  startSecond: number;
  endSecond: number;
  mediaAssetId: string;
  sha256: string;
  /** False once the retention purge deleted the original video; the row and its hash stay. */
  inStorage: boolean;
  firmwareVersion: string;
  deviceSerial: string;
  recordedFrom: Date;
};

export type ReviewEntry = { decision: string; note: string | null; createdAt: Date; reviewer: string };

export type ObservationEvidence = {
  id: string;
  pseudonym: string;
  timezone: string;
  eventTypeKey: string;
  eventTypeLabel: string;
  startedAt: Date;
  endedAt: Date;
  attributes: Record<string, unknown>;
  confidence: number | null;
  superseded: boolean;
  modelVersion: string;
  pipelineVersion: string;
  protocolVersion: string;
  cuts: EvidenceCut[];
  /** Newest first. The latest one is the effective review. */
  reviews: ReviewEntry[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getObservationEvidence(studyId: string, observationId: string): Promise<ObservationEvidence | null> {
  if (!UUID.test(observationId)) return null;
  const { rows } = await db.execute<{
    id: string; pseudonym: string; timezone: string; event_type_key: string; event_type_label: string; started_at: Date; ended_at: Date;
    attributes: Record<string, unknown>; confidence: number | null; superseded: boolean; model_version: string; pipeline_version: string; protocol_version: string;
  }>(sql`
    select o.id, p.pseudonym, p.timezone, et.key as event_type_key, et.label as event_type_label, o.started_at, o.ended_at,
           o.attributes, o.confidence, o.superseded_by_run_id is not null as superseded,
           pr.model_version, pr.pipeline_version, pv.version_label as protocol_version
    from observations o
    join participants p on p.id = o.participant_id
    join event_types et on et.id = o.event_type_id
    join pipeline_runs pr on pr.id = o.pipeline_run_id
    join protocol_versions pv on pv.id = pr.protocol_version_id
    where o.id = ${observationId} and p.study_id = ${studyId}`);
  const row = rows[0];
  if (!row) return null;

  const [cuts, reviews] = await Promise.all([
    db.execute<{ start_second: number; end_second: number; media_asset_id: string; sha256: string; in_storage: boolean; firmware_version: string; serial: string; recorded_from: Date }>(sql`
      select ev.start_second, ev.end_second, m.id as media_asset_id, m.sha256, m.storage_key is not null as in_storage,
             m.firmware_version, d.serial, m.recorded_from
      from observation_evidence ev
      join media_assets m on m.id = ev.media_asset_id
      join devices d on d.id = m.device_id
      where ev.observation_id = ${observationId}
      order by ev.start_second`),
    db.execute<{ decision: string; note: string | null; created_at: Date; full_name: string }>(sql`
      select rv.decision, rv.note, rv.created_at, r.full_name
      from observation_reviews rv
      join researchers r on r.id = rv.reviewer_id
      where rv.observation_id = ${observationId}
      order by rv.created_at desc, rv.id desc`),
  ]);

  return {
    id: row.id,
    pseudonym: row.pseudonym,
    timezone: row.timezone,
    eventTypeKey: row.event_type_key,
    eventTypeLabel: row.event_type_label,
    startedAt: new Date(row.started_at),
    endedAt: new Date(row.ended_at),
    attributes: row.attributes,
    confidence: row.confidence,
    superseded: row.superseded,
    modelVersion: row.model_version,
    pipelineVersion: row.pipeline_version,
    protocolVersion: row.protocol_version,
    cuts: cuts.rows.map((c) => ({
      startSecond: c.start_second,
      endSecond: c.end_second,
      mediaAssetId: c.media_asset_id,
      sha256: c.sha256,
      inStorage: c.in_storage,
      firmwareVersion: c.firmware_version,
      deviceSerial: c.serial,
      recordedFrom: new Date(c.recorded_from),
    })),
    reviews: reviews.rows.map((r) => ({ decision: r.decision, note: r.note, createdAt: new Date(r.created_at), reviewer: r.full_name })),
  };
}

/**
 * A short-lived URL for the observation's clip, or null when there is none to show: object storage isn't configured,
 * the clip was never published, or the retention purge removed it. Handing out the URL is what gives access to a
 * participant's footage, so each one is recorded in the audit log (`view_evidence`).
 */
export async function getClipUrl(studyId: string, observationId: string): Promise<string | null> {
  if (!process.env.S3_ENDPOINT) return null;
  try {
    const storage = createStorage();
    if (!(await storage.head(clipKey(observationId)))) return null;
    const url = await storage.presignGet(clipKey(observationId), { expiresIn: 15 * 60 });
    const [study] = await db.execute<{ created_by: string }>(sql`select created_by from studies where id = ${studyId}`).then((r) => r.rows);
    // No researcher auth yet: attributed to the study's creator, like exports and participant changes.
    await db.insert(auditLog).values({
      actorType: "researcher",
      actorId: study?.created_by,
      action: "view_evidence",
      entity: "observation",
      entityId: observationId,
      metadata: { actor_basis: "placeholder_no_auth" },
    });
    return url;
  } catch (error) {
    console.error("clip lookup failed", error instanceof Error ? error.message : error);
    return null;
  }
}
