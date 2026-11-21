import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, primaryKey, real, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, oneOf, tstz } from "./_shared";
import { participants } from "./participants";

export const FORM_FACTOR = ["wristband", "clip", "pendant"] as const;

export const devices = pgTable(
  "devices",
  {
    id: id(),
    serial: text().notNull().unique(),
    hardwareRevision: text().notNull(),
    formFactor: text({ enum: FORM_FACTOR }).notNull(),
    registeredAt: createdAt(),
  },
  (t) => [oneOf("devices_form_factor_check", t.formFactor, FORM_FACTOR)],
);

// One device per participant and one participant per device at any instant (EXCLUDE in custom migration).
export const deviceAssignments = pgTable(
  "device_assignments",
  {
    id: id(),
    deviceId: uuid()
      .notNull()
      .references(() => devices.id),
    participantId: uuid()
      .notNull()
      .references(() => participants.id),
    validFrom: tstz().notNull(),
    validTo: tstz(),
  },
  (t) => [check("device_assignments_range_check", sql`${t.validTo} is null or ${t.validTo} > ${t.validFrom}`)],
);

// Modular hardware: a new sensor is a new row here, never a new column anywhere.
export const sensorTypes = pgTable("sensor_types", {
  // 'temperature_c', 'humidity_pct' (DHT11), 'co_raw' (MQ-7), 'flammable_gas_raw' (MQ-2),
  // 'sound_level_raw' (KY-037), 'battery_mv' (2S pack voltage). Uncalibrated sensors keep a *_raw
  // key: they are relative context, not certified units (AGENTS.md §2.5). The pendant's types are
  // inserted by migration 0003, so ingestion works without the demo seed.
  key: text().primaryKey(),
  unit: text().notNull(),
  description: text(),
});

// A physical sensor mounted on a device, with its calibration. Swapping or recalibrating a part
// is a new row, so every reading stays traceable to the exact component that produced it.
export const deviceSensors = pgTable(
  "device_sensors",
  {
    id: id(),
    deviceId: uuid()
      .notNull()
      .references(() => devices.id),
    sensorTypeKey: text()
      .notNull()
      .references(() => sensorTypes.key),
    componentModel: text().notNull(), // 'DHT11', 'MQ-7', 'KY-037'
    calibration: jsonb(), // coefficients, method
    calibratedAt: tstz(),
    installedAt: tstz().notNull(),
    removedAt: tstz(),
  },
  (t) => [index().on(t.deviceId)],
);

export const deviceHeartbeats = pgTable(
  "device_heartbeats",
  {
    deviceId: uuid()
      .notNull()
      .references(() => devices.id),
    receivedAt: tstz().notNull(),
    batteryPct: real(),
    storageFreeMb: integer(),
    firmwareVersion: text().notNull(),
    rtcDriftMs: integer(),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.receivedAt] })],
);
