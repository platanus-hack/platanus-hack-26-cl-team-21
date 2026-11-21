import { sql } from "drizzle-orm";
import { check, integer, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, oneOf } from "./_shared";

export const researchers = pgTable("researchers", {
  id: id(),
  email: text().notNull().unique(),
  fullName: text().notNull(),
  createdAt: createdAt(),
});

export const STUDY_STATUS = ["draft", "active", "paused", "closed"] as const;

export const studies = pgTable(
  "studies",
  {
    id: id(),
    code: text().notNull().unique(),
    title: text().notNull(),
    description: text(),
    status: text({ enum: STUDY_STATUS }).notNull().default("draft"),
    // Raw video lives this many days, then only its tombstone row remains (see media_assets).
    mediaRetentionDays: integer().notNull().default(7),
    // Upper bound for retention holds (e.g. an open discrepancy) beyond the base retention.
    maxHoldDays: integer().notNull().default(14),
    createdBy: uuid().notNull().references(() => researchers.id),
    createdAt: createdAt(),
  },
  (t) => [
    oneOf("studies_status_check", t.status, STUDY_STATUS),
    check("studies_retention_check", sql`${t.mediaRetentionDays} between 0 and 30 and ${t.maxHoldDays} between 0 and 60`),
  ],
);

export const STUDY_ROLE = ["owner", "analyst", "reviewer", "annotator"] as const;

export const studyMembers = pgTable(
  "study_members",
  {
    studyId: uuid().notNull().references(() => studies.id),
    researcherId: uuid().notNull().references(() => researchers.id),
    role: text({ enum: STUDY_ROLE }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.studyId, t.researcherId] }), oneOf("study_members_role_check", t.role, STUDY_ROLE)],
);
