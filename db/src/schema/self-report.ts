import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, real, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, oneOf, tstz } from "./_shared";
import { devices } from "./devices";
import { participants } from "./participants";
import { observations, pipelineRuns } from "./pipeline";
import { emaItems, eventTypes } from "./protocols";
import { researchers } from "./studies";

export const REPORT_CHANNEL = ["device_button", "app"] as const;

export const emaPrompts = pgTable(
  "ema_prompts",
  {
    id: uuid().primaryKey(), // generated where the prompt fires (device/app)
    participantId: uuid()
      .notNull()
      .references(() => participants.id),
    emaItemId: uuid()
      .notNull()
      .references(() => emaItems.id),
    promptedAt: tstz().notNull(),
    expiresAt: tstz().notNull(),
    channel: text({ enum: REPORT_CHANNEL }).notNull(),
  },
  (t) => [index().on(t.participantId, t.promptedAt), oneOf("ema_prompts_channel_check", t.channel, REPORT_CHANNEL)],
);

// What the person perceives. Sensor context is not copied here: it is computed from sensor_chunks
// with sensor_window_stats(), so recalibrations or late batches are reflected automatically.
export const emaResponses = pgTable(
  "ema_responses",
  {
    id: uuid().primaryKey(), // generated on the device/phone
    participantId: uuid()
      .notNull()
      .references(() => participants.id),
    emaItemId: uuid()
      .notNull()
      .references(() => emaItems.id),
    promptId: uuid()
      .unique()
      .references(() => emaPrompts.id), // null = spontaneous answer
    answeredAt: tstz().notNull(),
    channel: text({ enum: REPORT_CHANNEL }).notNull(),
    deviceId: uuid().references(() => devices.id),
    valueNumeric: real(),
    valueChoice: text(),
  },
  (t) => [
    index().on(t.participantId, t.answeredAt),
    oneOf("ema_responses_channel_check", t.channel, REPORT_CHANNEL),
    check("ema_responses_value_check", sql`${t.valueNumeric} is not null or ${t.valueChoice} is not null`),
  ],
);

// "I ate between 13:00 and 13:30". Blind: the participant never sees what the model detected,
// otherwise the report stops being an independent measurement (and nudges behaviour).
// recall lag = reported_at - ended_at is itself a memory-bias variable.
export const activityReports = pgTable(
  "activity_reports",
  {
    id: uuid().primaryKey(), // generated on the phone
    participantId: uuid()
      .notNull()
      .references(() => participants.id),
    eventTypeId: uuid()
      .notNull()
      .references(() => eventTypes.id),
    startedAt: tstz().notNull(),
    endedAt: tstz().notNull(),
    reportedAt: tstz().notNull(),
    channel: text({ enum: REPORT_CHANNEL }).notNull(),
    attributes: jsonb().notNull().default({}),
    note: text(),
  },
  (t) => [
    index().on(t.participantId, t.startedAt),
    oneOf("activity_reports_channel_check", t.channel, REPORT_CHANNEL),
    check("activity_reports_range_check", sql`${t.endedAt} >= ${t.startedAt}`),
  ],
);

export const DISCREPANCY_KIND = [
  "reported_not_detected",
  "detected_not_reported",
  "category_mismatch",
  "timing_mismatch",
  "value_mismatch",
] as const;
export const DISCREPANCY_STATUS = ["open", "reprocessing", "resolved"] as const;
export const DISCREPANCY_RESOLUTION = ["model_error", "report_error", "capture_failure", "ambiguous", "no_evidence"] as const;

// Self-report vs model disagreement. Neither side is ever overwritten: the gap between what people
// say and what happens is the scientific signal. The unique key makes the detector idempotent.
export const discrepancies = pgTable(
  "discrepancies",
  {
    id: id(),
    participantId: uuid()
      .notNull()
      .references(() => participants.id),
    kind: text({ enum: DISCREPANCY_KIND }).notNull(),
    activityReportId: uuid().references(() => activityReports.id),
    observationId: uuid().references(() => observations.id),
    detectorVersion: text().notNull(),
    detectedAt: createdAt(),
    status: text({ enum: DISCREPANCY_STATUS }).notNull().default("open"),
    resolution: text({ enum: DISCREPANCY_RESOLUTION }),
    resolvedBy: uuid().references(() => researchers.id),
    resolvedAt: tstz(),
    reprocessRunId: uuid().references(() => pipelineRuns.id),
    note: text(),
  },
  (t) => [
    unique("discrepancies_pair_unique").on(t.kind, t.activityReportId, t.observationId).nullsNotDistinct(),
    index("discrepancies_open_idx")
      .on(t.participantId)
      .where(sql`${t.status} <> 'resolved'`),
    oneOf("discrepancies_kind_check", t.kind, DISCREPANCY_KIND),
    oneOf("discrepancies_status_check", t.status, DISCREPANCY_STATUS),
    oneOf("discrepancies_resolution_check", t.resolution, DISCREPANCY_RESOLUTION),
    check("discrepancies_side_check", sql`${t.activityReportId} is not null or ${t.observationId} is not null`),
    check("discrepancies_resolved_check", sql`(${t.status} = 'resolved') = (${t.resolution} is not null)`),
  ],
);
