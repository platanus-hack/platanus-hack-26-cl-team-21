import { sql } from "drizzle-orm";
import { db } from "./client";

// Typed wrappers over the SQL functions in the db_rules migration. Sensor readings are stored as
// hourly arrays, so they are never written with a plain insert: always go through these.

type Executor = Pick<typeof db, "execute">; // db or a transaction

export type Reading = {
  at: Date;
  value: number;
};

/** Merges readings into a series. Idempotent: re-sending a batch does not change the result. */
export async function ingestSensorReadings(seriesId: number, readings: Reading[], tx: Executor = db): Promise<number> {
  if (readings.length === 0) return 0;
  const result = await tx.execute<{ written: number }>(sql`
    select ingest_sensor_readings(
      ${seriesId}::int,
      ${sql.param(readings.map((r) => r.at.toISOString()))}::timestamptz[],
      ${sql.param(readings.map((r) => r.value))}::real[]
    ) as written`);
  return Number(result.rows[0].written);
}

export type SensorWindowStats = {
  sensorType: string;
  unit: string;
  n: number;
  mean: number | null;
  min: number | null;
  max: number | null;
};

/** Per-sensor stats of a participant in [from, to): the context of an EMA answer or an episode. */
export async function sensorWindowStats(participantId: string, from: Date, to: Date, tx: Executor = db) {
  const result = await tx.execute<SensorWindowStats>(sql`
    select sensor_type as "sensorType", unit, n::int as n, mean, min, max
    from sensor_window_stats(${participantId}::uuid, ${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz)`);
  return result.rows;
}

export type SensorDailyRow = {
  participantId: string;
  sensorType: string;
  unit: string;
  localDay: string; // YYYY-MM-DD, participant's local day
  n: number;
  expected: number;
  coverage: number; // n / expected
  mean: number | null;
  min: number | null;
  max: number | null;
};

/** Daily stats per participant x sensor for local days [fromDay, toDay] (inclusive). */
export async function sensorDaily(
  args: { studyId: string; fromDay: string; toDay: string; participantId?: string },
  tx: Executor = db,
) {
  const result = await tx.execute<SensorDailyRow>(sql`
    select participant_id as "participantId", sensor_type as "sensorType", unit,
           to_char(local_day, 'YYYY-MM-DD') as "localDay", n, expected, coverage, mean, min, max
    from sensor_daily(${args.studyId}::uuid, ${args.fromDay}::date, ${args.toDay}::date, ${args.participantId ?? null}::uuid)
    order by 1, 2, 4`);
  return result.rows;
}
