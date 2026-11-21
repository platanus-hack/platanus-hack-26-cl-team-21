import { sql } from "drizzle-orm";
import { bigserial, check, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, oneOf, tstz } from "./_shared";
import { discrepancies } from "./self-report";
import { mediaAssets } from "./capture";
import { participants } from "./participants";
import { eventTypes } from "./protocols";
import { researchers, studies } from "./studies";

export const HOLD_REASON = ["discrepancy", "reference_annotation", "manual_review"] as const;

// Keeps a video past its base retention (only if the consent allows it; enforced by the app layer
// that creates holds). Effective retention = max(base, active holds), capped at base +
// studies.max_hold_days — see v_media_retention.
export const retentionHolds = pgTable(
  "retention_holds",
  {
    id: id(),
    mediaAssetId: uuid()
      .notNull()
      .references(() => mediaAssets.id),
    reason: text({ enum: HOLD_REASON }).notNull(),
    discrepancyId: uuid().references(() => discrepancies.id),
    createdBy: uuid().references(() => researchers.id), // null = system
    createdAt: createdAt(),
    expiresAt: tstz().notNull(),
    releasedAt: tstz(),
  },
  (t) => [
    index().on(t.mediaAssetId),
    oneOf("retention_holds_reason_check", t.reason, HOLD_REASON),
    check("retention_holds_discrepancy_check", sql`${t.reason} <> 'discrepancy' or ${t.discrepancyId} is not null`),
  ],
);

// Independent annotators: the reference to compute precision/recall. Must happen while the video
// still exists (inside the retention window or under a hold).
export const referenceAnnotations = pgTable(
  "reference_annotations",
  {
    id: id(),
    participantId: uuid()
      .notNull()
      .references(() => participants.id),
    annotatorId: uuid()
      .notNull()
      .references(() => researchers.id),
    mediaAssetId: uuid().references(() => mediaAssets.id),
    eventTypeId: uuid()
      .notNull()
      .references(() => eventTypes.id),
    startedAt: tstz().notNull(),
    endedAt: tstz().notNull(),
    attributes: jsonb().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.participantId, t.startedAt), check("reference_annotations_range_check", sql`${t.endedAt} >= ${t.startedAt}`)],
);

// Variables the researcher brings: arm, clinical scales per wave, questionnaires.
export const externalVariables = pgTable(
  "external_variables",
  {
    id: id(),
    studyId: uuid()
      .notNull()
      .references(() => studies.id),
    participantId: uuid()
      .notNull()
      .references(() => participants.id),
    key: text().notNull(), // 'phq9_total', 'wave'
    value: jsonb().notNull(),
    measuredAt: tstz(),
    source: text(),
    uploadedBy: uuid()
      .notNull()
      .references(() => researchers.id),
    uploadedAt: createdAt(),
  },
  (t) => [index().on(t.participantId, t.key)],
);

export const EXPORT_FORMAT = ["csv", "json", "parquet"] as const;
export const EXPORT_STATUS = ["queued", "running", "ready", "failed"] as const;

export const exports = pgTable(
  "exports",
  {
    id: id(),
    studyId: uuid()
      .notNull()
      .references(() => studies.id),
    requestedBy: uuid()
      .notNull()
      .references(() => researchers.id),
    params: jsonb().notNull(), // filters, variables, granularity
    format: text({ enum: EXPORT_FORMAT }).notNull(),
    status: text({ enum: EXPORT_STATUS }).notNull().default("queued"),
    storageKey: text(),
    sha256: text(),
    createdAt: createdAt(),
  },
  (t) => [oneOf("exports_format_check", t.format, EXPORT_FORMAT), oneOf("exports_status_check", t.status, EXPORT_STATUS)],
);

export const ACTOR_TYPE = ["researcher", "participant", "system"] as const;

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    actorType: text({ enum: ACTOR_TYPE }).notNull(),
    actorId: uuid(),
    action: text().notNull(), // 'view_evidence', 'export', 'delete_media'
    entity: text().notNull(),
    entityId: uuid(),
    metadata: jsonb(),
    at: tstz().notNull().defaultNow(),
  },
  (t) => [index().on(t.entity, t.entityId), oneOf("audit_log_actor_type_check", t.actorType, ACTOR_TYPE)],
);
