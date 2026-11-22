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
} from "@observatorio/db";
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
  video: { sha256: string; bytes: number; storageKey: string };
  frames: string;
  sensors: string;
  events: string;
  excluded: Interval[];
}

// Writes everything `complete` derives from a verified session bundle (ADR 0002 §5 and §7), inside the caller's
// transaction so the upload either lands whole or not at all.
export async function ingestSession(tx: Tx, s: SessionIngest) {
  const frameTimes = parseFrameTimes(s.frames);
  const { events, privacy } = parseEvents(s.events, s.deviceSerial, s.recordedTo.getTime());

  await insertVideoAsset(tx, s, frameTimes);
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
    hasVideo: true,
  });
  await tx.delete(coverageIntervals).where(eq(coverageIntervals.batchId, s.batchId));
  if (rows.length) {
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
  }
}

// media_assets.sha256 is globally unique: the same video under another upload is a conflict, not a 500.
async function insertVideoAsset(tx: Tx, s: SessionIngest, frameTimes: number[]) {
  const [duplicate] = await tx
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.sha256, s.video.sha256), ne(mediaAssets.id, s.batchId)));
  if (duplicate) throw new ApiError(409, "upload_conflict", "This video was already uploaded");

  const [study] = await tx.select({ days: studies.mediaRetentionDays }).from(studies).where(eq(studies.id, s.studyId));
  const first = frameTimes.length ? Math.min(...frameTimes) : s.recordedFrom.getTime();
  const last = frameTimes.length ? Math.max(...frameTimes) : s.recordedTo.getTime();
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
      sha256: s.video.sha256,
      sizeBytes: s.video.bytes,
      mimeType: "video/mp4",
      storageKey: s.video.storageKey,
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
