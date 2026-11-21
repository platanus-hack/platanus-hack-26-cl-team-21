import { type AnyPgColumn, bigint, check, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id, oneOf, tstz } from "./_shared";
import { devices } from "./devices";
import { participants } from "./participants";
import { captureWindows } from "./protocols";

export const CAPTURE_OUTCOME = ["pending", "accepted", "postponed", "declined", "missed", "manual"] as const;

// Every camera opportunity and what the participant did with it. Declines and postponements are
// data too: they explain gaps without revealing content.
export const capturePrompts = pgTable(
  "capture_prompts",
  {
    id: id(),
    participantId: uuid()
      .notNull()
      .references(() => participants.id),
    captureWindowId: uuid().references(() => captureWindows.id), // null = participant-triggered
    parentPromptId: uuid().references((): AnyPgColumn => capturePrompts.id), // chain of postponements
    scheduledFor: tstz().notNull(),
    notifiedAt: tstz(),
    respondedAt: tstz(),
    outcome: text({ enum: CAPTURE_OUTCOME }).notNull().default("pending"),
  },
  (t) => [
    index().on(t.participantId, t.scheduledFor),
    oneOf("capture_prompts_outcome_check", t.outcome, CAPTURE_OUTCOME),
    check("capture_prompts_manual_check", sql`(${t.outcome} = 'manual') = (${t.captureWindowId} is null)`),
  ],
);

export const MEDIA_KIND = ["video", "image"] as const;
export const MEDIA_STATUS = ["uploaded", "processing", "processed", "failed", "deleted"] as const;

// The row outlives the file: after retention the object is deleted and the row stays as a
// tombstone (hash, size, interval, device) proving the video existed and was not altered.
// Content the participant excluded on the phone never gets a row; it shows up only as a
// coverage interval ('excluded_by_participant').
export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid().primaryKey(), // generated on the phone
    participantId: uuid()
      .notNull()
      .references(() => participants.id),
    deviceId: uuid()
      .notNull()
      .references(() => devices.id),
    capturePromptId: uuid().references(() => capturePrompts.id),
    firmwareVersion: text().notNull(), // device firmware that recorded the clip
    kind: text({ enum: MEDIA_KIND }).notNull(),
    recordedFrom: tstz().notNull(),
    recordedTo: tstz().notNull(),
    sha256: text().notNull().unique(),
    sizeBytes: bigint({ mode: "number" }).notNull(),
    mimeType: text(),
    storageKey: text(), // null once deleted
    status: text({ enum: MEDIA_STATUS }).notNull().default("uploaded"),
    uploadedAt: tstz().notNull().defaultNow(),
    baseRetainUntil: tstz().notNull(), // uploaded_at + studies.media_retention_days
    deletedAt: tstz(),
    deletionReason: text(), // 'retention_expired' | 'participant_request' | 'withdrawal'
  },
  (t) => [
    index().on(t.participantId, t.recordedFrom),
    // the purge job only looks at files still in storage
    index("media_assets_purge_idx")
      .on(t.baseRetainUntil)
      .where(sql`${t.storageKey} is not null`),
    oneOf("media_assets_kind_check", t.kind, MEDIA_KIND),
    oneOf("media_assets_status_check", t.status, MEDIA_STATUS),
    check("media_assets_range_check", sql`${t.recordedTo} >= ${t.recordedFrom}`),
    check(
      "media_assets_tombstone_check",
      sql`(${t.status} = 'deleted') = (${t.storageKey} is null) and (${t.status} = 'deleted') = (${t.deletedAt} is not null)`,
    ),
  ],
);
