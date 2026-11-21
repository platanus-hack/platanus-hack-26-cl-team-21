import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Work queue between web (enqueues) and worker (processes videos, AI calls).
export const jobs = pgTable("jobs", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  type: text().notNull(),
  payload: jsonb().notNull().default({}),
  status: text({ enum: ["pending", "running", "done", "failed"] }).notNull().default("pending"),
  error: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
