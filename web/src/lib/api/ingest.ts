import {
  and,
  coverageIntervals,
  db,
  deviceEvents,
  deviceSensors,
  eq,
  ingestSensorReadings,
  isNull,
  mediaAssets,
  ne,
  sensorSeries,
  sql,
  studies,
  syncBatches,
} from "@observatorio/db";
import { UPLOAD_FILES, uploadFileKey, type UploadFileKind } from "@observatorio/storage";
import { ApiError } from "./errors";
import { deriveCoverage, type Interval } from "./coverage";
import { parseEvents, parseFrameTimes, parseSensorReadings, SENSOR_COLUMNS } from "./session-files";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const SENSOR_PERIOD_S = 1;

export interface SessionIngest {
  batchId: string;
  studyId: string;
  participantId: string;
  deviceId: string;
  deviceSerial: string;
  firmwareVersion: string;
  recordedFrom: Date;
  recordedTo: Date;
  /** Absent when the participant excluded the whole clip: the upload then has no video or frames (ADR 0002 §5, `no_upload`). */
  video?: { sha256: string; bytes: number; storageKey: string };
  frames: string;
  sensors: string;
  events: string;
  excluded: Interval[];
}

// Writes everything `complete` derives from a verified session bundle (ADR 0002 §5 and §7), inside the caller's
// transaction so the upload either lands whole or not at all.
export async function ingestSession(tx: Tx, s: SessionIngest) {
  // The first upload of a device creates its device_sensors rows: two at once would each create their own and split
  // the readings across series. Held until the transaction ends.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${s.deviceId}, 0))`);

  const frameTimes = parseFrameTimes(s.frames);
  const { events, privacy } = parseEvents(s.events, s.deviceSerial, s.recordedTo.getTime());

  if (s.video) await insertVideoAsset(tx, s, s.video, frameTimes);
  await insertSensorReadings(tx, s);

  if (events.length) {
    await tx
      .insert(deviceEvents)
      .values(events.map((e) => ({ ...e, kind: e.kind as never, deviceId: s.deviceId, batchId: s.batchId, firmwareVersion: s.firmwareVersion })))
      .onConflictDoNothing();
  }

  const rows = deriveCoverage({
    from: s.recordedFrom.getTime(),
    to: s.recordedTo.getTime(),
    privacy,
    excluded: s.excluded,
    frameTimesMs: frameTimes,
    hasVideo: Boolean(s.video),
  });
  await tx.delete(coverageIntervals).where(eq(coverageIntervals.batchId, s.batchId));
  if (rows.length) {
    try {
      await tx.insert(coverageIntervals).values(
        rows.map((r) => ({
          participantId: s.participantId,
          deviceId: s.deviceId,
          startedAt: new Date(r.start),
          endedAt: new Date(r.end),
          status: r.status,
          source: r.source,
          batchId: s.batchId,
        })),
      );
    } catch (error) {
      // coverage_intervals_no_overlap: another upload of this participant got in between `create` and `complete`.
      if (pgErrorCode(error) === "23P01") throw new ApiError(409, "upload_conflict", "Recorded range overlaps another upload");
      throw error;
    }
  }
}

const pgErrorCode = (error: unknown): string | undefined => {
  const e = error as { code?: string; cause?: { code?: string } };
  return e.code ?? e.cause?.code;
};

// media_assets.sha256 is globally unique: the same video under another upload is a conflict, not a 500. The one
// exception is a failed upload whose row was kept because evidence references it (see purgeFailedUploads): the retry
// reuses that row.
async function insertVideoAsset(tx: Tx, s: SessionIngest, video: NonNullable<SessionIngest["video"]>, frameTimes: number[]) {
  const [duplicate] = await tx
    .select({ id: mediaAssets.id, status: syncBatches.status })
    .from(mediaAssets)
    .leftJoin(syncBatches, eq(syncBatches.id, mediaAssets.id))
    .where(and(eq(mediaAssets.sha256, video.sha256), ne(mediaAssets.id, s.batchId)));
  if (duplicate?.status === "failed") return;
  if (duplicate) throw new ApiError(409, "upload_conflict", "This video was already uploaded");

  const [study] = await tx.select({ days: studies.mediaRetentionDays }).from(studies).where(eq(studies.id, s.studyId));
  // reduce, not Math.min(...frameTimes): spreading ~100k frames overflows the call stack.
  const first = frameTimes.length ? frameTimes.reduce((a, b) => Math.min(a, b)) : s.recordedFrom.getTime();
  const last = frameTimes.length ? frameTimes.reduce((a, b) => Math.max(a, b)) : s.recordedTo.getTime();
  await tx
    .insert(mediaAssets)
    .values({
      id: s.batchId,
      participantId: s.participantId,
      deviceId: s.deviceId,
      firmwareVersion: s.firmwareVersion,
      kind: "video",
      recordedFrom: new Date(first),
      recordedTo: new Date(last),
      sha256: video.sha256,
      sizeBytes: video.bytes,
      mimeType: "video/mp4",
      storageKey: video.storageKey,
      baseRetainUntil: sql`now() + make_interval(days => ${study.days})`,
    })
    .onConflictDoNothing({ target: mediaAssets.id });
}

// One device_sensors row per pendant component and one 1 s sensor_series per participant and sensor, created on
// first use (ADR 0002 §8, "still open").
async function insertSensorReadings(tx: Tx, s: SessionIngest) {
  for (const [key, readings] of parseSensorReadings(s.sensors)) {
    const component = SENSOR_COLUMNS.find((c) => c.key === key)!.component;
    const [existing] = await tx
      .select({ id: deviceSensors.id })
      .from(deviceSensors)
      .where(and(eq(deviceSensors.deviceId, s.deviceId), eq(deviceSensors.sensorTypeKey, key), isNull(deviceSensors.removedAt)));
    const deviceSensorId =
      existing?.id ??
      (await tx.insert(deviceSensors).values({ deviceId: s.deviceId, sensorTypeKey: key, componentModel: component, installedAt: new Date() }).returning({ id: deviceSensors.id }))[0].id;

    await tx.insert(sensorSeries).values({ participantId: s.participantId, deviceSensorId, periodS: SENSOR_PERIOD_S }).onConflictDoNothing();
    const [series] = await tx
      .select({ id: sensorSeries.id })
      .from(sensorSeries)
      .where(and(eq(sensorSeries.participantId, s.participantId), eq(sensorSeries.deviceSensorId, deviceSensorId)));
    await ingestSensorReadings(series.id, readings, tx);
  }
}

/**
 * Retry of a failed upload (ADR 0002 §3): a new `upload_id` for the same device session replaces the failed one, so
 * its coverage, device events and media_assets row go (the sha256 is globally unique, and the new upload carries the
 * same video). The failed sync_batches row stays for traceability. A media row that observations, runs, holds or
 * annotations reference is kept, with its object. Returns the object keys to delete once the transaction commits.
 */
export async function purgeFailedUploads(
  tx: Tx,
  owner: { studyId: string; participantId: string },
  deviceSessionId: string,
  recordedFrom: string,
  recordedTo: string,
): Promise<string[]> {
  const failed = await tx
    .select({ id: syncBatches.id })
    .from(syncBatches)
    .where(
      and(
        eq(syncBatches.participantId, owner.participantId),
        eq(syncBatches.deviceSessionId, deviceSessionId),
        eq(syncBatches.status, "failed"),
        sql`${syncBatches.recordedFrom} < ${recordedTo}::timestamptz and ${syncBatches.recordedTo} > ${recordedFrom}::timestamptz`,
      ),
    );

  const keys: string[] = [];
  for (const { id } of failed) {
    await tx.delete(coverageIntervals).where(eq(coverageIntervals.batchId, id));
    await tx.delete(deviceEvents).where(eq(deviceEvents.batchId, id));

    const [media] = await tx.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.id, id));
    const { rows } = media
      ? await tx.execute(sql`
          delete from media_assets m where m.id = ${id}::uuid
            and not exists (select 1 from observation_evidence where media_asset_id = m.id)
            and not exists (select 1 from pipeline_run_inputs where media_asset_id = m.id)
            and not exists (select 1 from retention_holds where media_asset_id = m.id)
            and not exists (select 1 from reference_annotations where media_asset_id = m.id)
          returning m.id`)
      : { rows: [] };
    const mediaKept = Boolean(media) && rows.length === 0;

    for (const kind of Object.keys(UPLOAD_FILES) as UploadFileKind[]) {
      if (kind === "video" && mediaKept) continue;
      keys.push(uploadFileKey(owner.studyId, owner.participantId, id, kind));
    }
  }
  return keys;
}
