import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { id, oneOf, tstz } from "./_shared";
import { deviceSensors, devices } from "./devices";
import { participants } from "./participants";

// One upload from the app. The raw payload is kept in object storage (rawStorageKey) so any
// chunk can be rebuilt; (device, payload hash) makes re-sends a no-op.
export const syncBatches = pgTable(
  "sync_batches",
  {
    id: uuid().primaryKey(), // generated on the phone
    deviceId: uuid()
      .notNull()
      .references(() => devices.id),
    participantId: uuid()
      .notNull()
      .references(() => participants.id),
    firmwareVersion: text().notNull(),
    appVersion: text(),
    recordedFrom: tstz().notNull(),
    recordedTo: tstz().notNull(),
    payloadSha256: text().notNull(),
    rawStorageKey: text(),
    receivedAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.deviceId, t.payloadSha256),
    index().on(t.participantId, t.recordedFrom),
    check("sync_batches_range_check", sql`${t.recordedTo} >= ${t.recordedFrom}`),
  ],
);

export const DEVICE_EVENT_KIND = [
  "privacy_switch_on",
  "privacy_switch_off",
  "charging_started",
  "charging_stopped",
  "low_battery",
  "button_press",
  "storage_full",
  "sensor_fault",
] as const;

// Discrete events reported by the device (the `device_event` contract in AGENTS.md §5). They are
// the raw evidence behind derived coverage intervals (e.g. 'privacy_switch') and sensor gaps.
// Battery level and free storage are sampled in device_heartbeats instead.
export const deviceEvents = pgTable(
  "device_events",
  {
    id: uuid().primaryKey(), // generated on the phone/device, so re-sends are idempotent
    deviceId: uuid()
      .notNull()
      .references(() => devices.id),
    batchId: uuid().references(() => syncBatches.id),
    occurredAt: tstz().notNull(), // device RTC time
    kind: text({ enum: DEVICE_EVENT_KIND }).notNull(),
    payload: jsonb(), // e.g. { "sensor": "co_raw", "error": "timeout" } for sensor_fault
    firmwareVersion: text().notNull(),
    receivedAt: tstz().notNull().defaultNow(),
  },
  (t) => [index().on(t.deviceId, t.occurredAt), oneOf("device_events_kind_check", t.kind, DEVICE_EVENT_KIND)],
);

// A regular time series: one sensor of one participant at a fixed sampling period.
// Small integer id because it is repeated in every chunk row.
export const sensorSeries = pgTable(
  "sensor_series",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    participantId: uuid()
      .notNull()
      .references(() => participants.id),
    deviceSensorId: uuid()
      .notNull()
      .references(() => deviceSensors.id),
    periodS: smallint().notNull(), // must divide 3600
  },
  (t) => [
    unique().on(t.participantId, t.deviceSensorId),
    check("sensor_series_period_check", sql`${t.periodS} > 0 and 3600 % ${t.periodS} = 0`),
  ],
);

// Sensor readings stored as one row per series-hour: vals[i] is the reading at
// chunk_start + (i-1)*period_s (NULL = no reading). Benchmarked at ~4.6 bytes/reading vs ~116-240
// for one row per reading. Write only through ingest_sensor_readings() (custom migration), which
// merges idempotently and keeps sensor_hourly in sync in the same transaction.
// A high-rate signal (e.g. a future IMU at 50 Hz) would stay in object storage, with only
// per-epoch features landing here.
export const sensorChunks = pgTable(
  "sensor_chunks",
  {
    seriesId: integer()
      .notNull()
      .references(() => sensorSeries.id),
    chunkStart: tstz().notNull(), // top of a UTC hour
    periodS: smallint().notNull(),
    vals: real().array().notNull(),
    updatedAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.seriesId, t.chunkStart] }),
    // Hours are always UTC hours, whatever the session TimeZone of the writer.
    check("sensor_chunks_hour_check", sql`date_trunc('hour', ${t.chunkStart}, 'UTC') = ${t.chunkStart}`),
    check("sensor_chunks_len_check", sql`cardinality(${t.vals}) = 3600 / ${t.periodS}`),
  ],
);

// Hourly stats of each chunk, in their own narrow table (~35 MB vs ~290 MB for the chunks in the
// benchmark): daily, longitudinal and coverage queries scan this, never the raw arrays.
export const sensorHourly = pgTable(
  "sensor_hourly",
  {
    seriesId: integer().notNull(),
    hour: tstz().notNull(),
    n: smallint().notNull(), // non-null readings
    vSum: doublePrecision().notNull(),
    vMin: real(),
    vMax: real(),
  },
  (t) => [
    primaryKey({ columns: [t.seriesId, t.hour] }),
    foreignKey({ columns: [t.seriesId, t.hour], foreignColumns: [sensorChunks.seriesId, sensorChunks.chunkStart] }),
  ],
);

// "Not observed" is not "did not happen": a gap-free timeline of why there is or isn't data.
// Values are the `coverage_interval.status` contract in AGENTS.md §5.
export const COVERAGE_STATUS = [
  "observed",
  "excluded_by_participant",
  "privacy_switch",
  "device_off",
  "low_battery",
  "no_upload",
  "low_quality",
] as const;
export const COVERAGE_SOURCE = ["device", "app", "derived"] as const;

export const coverageIntervals = pgTable(
  "coverage_intervals",
  {
    id: id(),
    participantId: uuid()
      .notNull()
      .references(() => participants.id),
    deviceId: uuid().references(() => devices.id),
    startedAt: tstz().notNull(),
    endedAt: tstz().notNull(),
    status: text({ enum: COVERAGE_STATUS }).notNull(),
    source: text({ enum: COVERAGE_SOURCE }).notNull(),
    batchId: uuid().references(() => syncBatches.id),
  },
  (t) => [
    oneOf("coverage_intervals_status_check", t.status, COVERAGE_STATUS),
    oneOf("coverage_intervals_source_check", t.source, COVERAGE_SOURCE),
    check("coverage_intervals_range_check", sql`${t.endedAt} > ${t.startedAt}`),
  ],
);
