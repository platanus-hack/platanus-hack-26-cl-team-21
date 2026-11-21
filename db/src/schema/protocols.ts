import { sql } from "drizzle-orm";
import { type AnyPgColumn, check, integer, jsonb, pgTable, smallint, text, time, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, oneOf, tstz } from "./_shared";
import { researchers, studies } from "./studies";

export const PROTOCOL_STATUS = ["draft", "published", "retired"] as const;

// A published version is immutable (trigger in the custom migration). Changing the method means
// publishing a new version; participant_protocols records who ran under which version and when.
export const protocolVersions = pgTable(
  "protocol_versions",
  {
    id: id(),
    studyId: uuid().notNull().references(() => studies.id),
    versionLabel: text().notNull(), // 'mh-v1.2'
    parentVersionId: uuid().references((): AnyPgColumn => protocolVersions.id),
    definition: jsonb().notNull(), // full document: sensors, sampling, rules
    definitionSha256: text(),
    status: text({ enum: PROTOCOL_STATUS }).notNull().default("draft"),
    changeNote: text(),
    publishedBy: uuid().references(() => researchers.id),
    publishedAt: tstz(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.studyId, t.versionLabel),
    oneOf("protocol_versions_status_check", t.status, PROTOCOL_STATUS),
    check(
      "protocol_versions_published_check",
      sql`${t.status} = 'draft' or (${t.publishedAt} is not null and ${t.definitionSha256} is not null)`,
    ),
  ],
);

// Shared vocabulary for the model, the participant's reports and reference annotators: the three
// sources speak the same categories, which is what makes them comparable. `key` is stable across
// versions; longitudinal analyses group by key.
export const eventTypes = pgTable(
  "event_types",
  {
    id: id(),
    protocolVersionId: uuid().notNull().references(() => protocolVersions.id),
    key: text().notNull(), // 'eating_episode', 'drinking_episode'
    label: text().notNull(),
    attributesSchema: jsonb().notNull().default({}), // JSON Schema for observations.attributes
  },
  (t) => [unique().on(t.protocolVersionId, t.key)],
);

export const EMA_RESPONSE_TYPE = ["likert", "binary", "choice", "numeric"] as const;

export const emaItems = pgTable(
  "ema_items",
  {
    id: id(),
    protocolVersionId: uuid().notNull().references(() => protocolVersions.id),
    key: text().notNull(), // 'mood', 'stress'
    prompt: text().notNull(),
    responseType: text({ enum: EMA_RESPONSE_TYPE }).notNull(),
    options: jsonb(), // {"min":1,"max":5} or a list of choices
    triggerRule: jsonb().notNull(), // {"type":"random","perDay":4} | {"type":"afterEvent","event":"meal"}
  },
  (t) => [unique().on(t.protocolVersionId, t.key), oneOf("ema_items_response_type_check", t.responseType, EMA_RESPONSE_TYPE)],
);

// Camera windows agreed in the consent. The device warns `noticeMinutes` ahead; the participant
// can accept, postpone (up to maxPostpones x postponeMinutes) or decline. See capture_prompts.
export const captureWindows = pgTable(
  "capture_windows",
  {
    id: id(),
    protocolVersionId: uuid().notNull().references(() => protocolVersions.id),
    label: text(),
    daysOfWeek: smallint().array().notNull(), // ISO: 1=Monday … 7=Sunday
    startTime: time().notNull(), // participant's local time
    endTime: time().notNull(),
    noticeMinutes: integer().notNull().default(5),
    maxClipSeconds: integer().notNull().default(60),
    maxPostpones: integer().notNull().default(2),
    postponeMinutes: integer().notNull().default(15),
  },
  (t) => [
    check("capture_windows_time_check", sql`${t.endTime} > ${t.startTime}`),
    check("capture_windows_days_check", sql`${t.daysOfWeek} <@ array[1,2,3,4,5,6,7]::smallint[]`),
  ],
);
