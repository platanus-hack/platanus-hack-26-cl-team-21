import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, primaryKey, real, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, oneOf, tstz } from "./_shared";
import { mediaAssets } from "./capture";
import { jobs } from "./jobs";
import { participants } from "./participants";
import { eventTypes, protocolVersions } from "./protocols";
import { researchers } from "./studies";

export const RUN_TRIGGER = ["upload", "reprocess", "discrepancy"] as const;
export const RUN_STATUS = ["queued", "running", "succeeded", "failed"] as const;

// Everything needed to explain (or, while the video exists, re-run) a result. Together with the
// evidence clips it gives each observation the provenance AGENTS.md §2.3 requires:
// protocol_version, model_version, pipeline_version, device_id and firmware_version.
export const pipelineRuns = pgTable(
  "pipeline_runs",
  {
    id: id(),
    protocolVersionId: uuid()
      .notNull()
      .references(() => protocolVersions.id),
    jobId: integer().references(() => jobs.id),
    trigger: text({ enum: RUN_TRIGGER }).notNull(),
    modelProvider: text().notNull(),
    modelName: text().notNull(),
    modelVersion: text().notNull(),
    promptSha256: text(),
    params: jsonb().notNull().default({}),
    pipelineVersion: text().notNull(), // version / git sha of the worker pipeline
    status: text({ enum: RUN_STATUS }).notNull().default("queued"),
    startedAt: tstz(),
    finishedAt: tstz(),
    error: text(),
  },
  (t) => [oneOf("pipeline_runs_trigger_check", t.trigger, RUN_TRIGGER), oneOf("pipeline_runs_status_check", t.status, RUN_STATUS)],
);

export const pipelineRunInputs = pgTable(
  "pipeline_run_inputs",
  {
    runId: uuid()
      .notNull()
      .references(() => pipelineRuns.id),
    mediaAssetId: uuid()
      .notNull()
      .references(() => mediaAssets.id),
  },
  (t) => [primaryKey({ columns: [t.runId, t.mediaAssetId] })],
);

// One detected event (the `observation` contract in AGENTS.md §5). Never updated in place (trigger): a re-run
// writes new rows and marks the old ones superseded; human corrections go to observation_reviews.
// sensor_context is not stored: it is computed from the sensor tables with sensor_window_stats().
export const observations = pgTable(
  "observations",
  {
    id: id(),
    participantId: uuid()
      .notNull()
      .references(() => participants.id),
    pipelineRunId: uuid()
      .notNull()
      .references(() => pipelineRuns.id),
    eventTypeId: uuid()
      .notNull()
      .references(() => eventTypes.id),
    startedAt: tstz().notNull(),
    endedAt: tstz().notNull(),
    attributes: jsonb().notNull().default({}), // validated against event_types.attributes_schema
    confidence: real(), // model output, not a calibrated probability
    quality: jsonb(), // visibility, occlusion, motion
    supersededByRunId: uuid().references(() => pipelineRuns.id),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.participantId, t.startedAt),
    index("observations_current_idx")
      .on(t.participantId, t.startedAt)
      .where(sql`${t.supersededByRunId} is null`),
    check("observations_range_check", sql`${t.endedAt} >= ${t.startedAt}`),
    check("observations_confidence_check", sql`${t.confidence} between 0 and 1`),
  ],
);

// The authentic footage behind an observation: one or more cuts of original clips. The clip row
// keeps its sha256 after the file is deleted, so the reference stays verifiable.
export const observationEvidence = pgTable(
  "observation_evidence",
  {
    id: id(),
    observationId: uuid()
      .notNull()
      .references(() => observations.id),
    mediaAssetId: uuid()
      .notNull()
      .references(() => mediaAssets.id),
    startSecond: real().notNull(), // offsets inside the original clip
    endSecond: real().notNull(),
  },
  (t) => [
    index().on(t.observationId),
    index().on(t.mediaAssetId),
    check("observation_evidence_range_check", sql`${t.startSecond} >= 0 and ${t.endSecond} > ${t.startSecond}`),
  ],
);

export const REVIEW_DECISION = ["confirmed", "corrected", "rejected"] as const;

// Append-only (trigger); the latest review of an observation wins (its human_review_status).
// 'confirmed' means the model's output is right as is, so it drops an earlier correction.
// created_at uses clock_timestamp() so two reviews in one transaction still have an order.
export const observationReviews = pgTable(
  "observation_reviews",
  {
    id: id(),
    observationId: uuid()
      .notNull()
      .references(() => observations.id),
    reviewerId: uuid()
      .notNull()
      .references(() => researchers.id),
    decision: text({ enum: REVIEW_DECISION }).notNull(),
    correctedEventTypeId: uuid().references(() => eventTypes.id),
    correctedStartedAt: tstz(),
    correctedEndedAt: tstz(),
    correctedAttributes: jsonb(),
    note: text(),
    createdAt: tstz().notNull().default(sql`clock_timestamp()`),
  },
  (t) => [index().on(t.observationId, t.createdAt), oneOf("observation_reviews_decision_check", t.decision, REVIEW_DECISION)],
);
