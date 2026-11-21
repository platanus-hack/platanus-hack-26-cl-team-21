import { sql } from "drizzle-orm";
import { type AnyPgColumn, check, timestamp, uuid } from "drizzle-orm/pg-core";

// Conventions shared by every table:
// - uuid ids. Records born on the phone/device (EMA answers, reports, batches, media) get their id
//   on the client, so re-sending after a flaky connection is an idempotent insert.
// - Every instant is timestamptz. Intervals are two columns (started_at/ended_at); overlap rules
//   that Drizzle can't express live in the custom migration (EXCLUDE USING gist on tstzrange).
// - Closed vocabularies are text + CHECK built from one const array, so adding a value is a
//   one-line change plus a generated migration (no ALTER TYPE ... ADD VALUE dance).

export const id = () => uuid().primaryKey().defaultRandom();
export const tstz = () => timestamp({ withTimezone: true });
export const createdAt = () => tstz().notNull().defaultNow();

export function oneOf(name: string, column: AnyPgColumn, values: readonly string[]) {
  const list = values.map((v) => `'${v.replaceAll("'", "''")}'`).join(", ");
  return check(name, sql`${column} in (${sql.raw(list)})`);
}
