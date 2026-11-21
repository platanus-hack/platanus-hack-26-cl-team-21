# `@observatorio/db`

Schema, migrations and data access shared by `web` and `worker` (Drizzle + Postgres ≥ 15).

## Where things go

| What | Where |
|---|---|
| Tables, columns, FKs, `CHECK`, indexes, `UNIQUE` | `src/schema/<area>.ts`, then `npm run db:generate` |
| What Drizzle can't express: `EXCLUDE` (no-overlap), triggers, SQL functions, views | custom migration (`migrations/0002_db_rules.sql`); to change one, add a new one with `npm run generate -w db -- --custom --name <what>` |
| Reference rows the app needs in every environment (e.g. the pendant's `sensor_types`) and backfills | hand-written statements appended to the generated migration that needs them, idempotent (`on conflict do nothing`) |
| Reading/writing sensor series | `src/sensor-data.ts` (`ingestSensorReadings`, `sensorWindowStats`, `sensorDaily`) |
| Demo data (study `study-eating-001`, protocol `eating-v1`, 3 participants × 2 days, unused enrollment codes `EAT-001-P01`..`P03`) | `src/seed.ts`, run with `npm run db:seed` (idempotent: fixed ids + `on conflict do nothing`) |
| Tests for the database rules | `tests/rules.sql`, run with `npm run db:test` (inside a transaction that is rolled back) |

`drizzle-kit` diffs `schema.ts` against the snapshots, never against the live database, so objects created in the custom migration are left alone. After any change that doesn't touch the schema, `npm run db:generate` must say *No schema changes*.

Modules in `src/schema/`: `studies` · `protocols` · `participants` (real identity in the `identity` schema) · `devices` · `sensors` (sync batches, device events, sensor series, coverage) · `capture` (camera prompts and clips) · `pipeline` (AI runs, observations, evidence) · `self-report` (EMA, activity reports, discrepancies) · `research` (retention holds, reference annotations, external variables, exports, audit log).

## How the `AGENTS.md` §5 contracts map to tables

| Contract | Table(s) | Notes |
|---|---|---|
| `sensor_sample` | `sensor_series` + `sensor_chunks` / `sensor_hourly` | Written through `ingest_sensor_readings()`; `firmware_version` comes from `sync_batches` |
| `device_event` | `device_events` (battery level and storage: `device_heartbeats`) | Raw evidence behind derived coverage intervals |
| Session bundle upload ([ADR 0002](../docs/decisions/0002-contracts-v0.md)) | `sync_batches` + `sync_batch_files` | Upload state machine and declared files; enrollment lives on `participants` (`enrollment_code`, `token_sha256`). Full field mapping in ADR 0002 §7 |
| `clip_manifest` | `media_assets` | `clip_id` → `id`, `started_at`/`ended_at` → `recorded_from`/`recorded_to`, `storage_uri` → `storage_key`. Only approved clips are uploaded, so a row means `approved_by_participant = true` |
| `coverage_interval` | `coverage_intervals` | Same statuses |
| `observation` | `observations` + `observation_evidence` + `pipeline_runs`; read `v_current_observations` | Provenance lives on the run; `human_review_status` comes from the latest review; `sensor_context` is computed with `sensor_window_stats()` |

## Conventions

- **`uuid` ids.** Records born on the phone or the device (EMA answers, activity reports, sync batches, clips) carry an id generated on the client, so re-sending after a dropped connection is an idempotent insert.
- **Every instant is `timestamptz`.** Intervals are `started_at`/`ended_at`; no-overlap rules are `EXCLUDE USING gist` on `tstzrange(...)`.
- **Closed vocabularies** are `text` + a `CHECK` built from one `const` array (`oneOf` in `_shared.ts`). Adding a value is one line plus a generated migration. `coverage_intervals.status` follows the `coverage_interval` contract in `AGENTS.md` §5.
- **Nothing that matters for traceability is overwritten** (enforced by triggers): published protocols are immutable and only published versions can be assigned or run; observations only get marked as superseded by a re-run; human reviews are append-only; a sensor series never changes its period, participant or sensor. Discrepancies never edit the report or the observation.
- **Not observed ≠ did not happen:** `coverage_intervals` holds one status per participant per instant.

## Sensor series

Readings are stored **per series and hour**: `sensor_chunks.vals[i]` is the reading at `chunk_start + (i-1)·period_s` (UTC hours, `NULL` = no reading), and `sensor_hourly` holds n/sum/min/max of each hour. They are written **only** through `ingest_sensor_readings()`, which merges partial, out-of-order or repeated batches (each timestamp snaps to the nearest slot, max error `period_s/2`) and recomputes that hour's stats in the same transaction. NULL and non-finite values are skipped. Provenance per reading (device, firmware) comes from `sync_batches`, whose raw payload is kept in object storage.

Why (local benchmark, PG 15, 20 participants × 14 days × 6 sensors = 14.5 M readings):

| Layout | Bytes/reading | Daily mean, 1 participant | Study-wide daily table |
|---|---:|---:|---:|
| One row per reading (uuid keys) | 239 | – | – |
| One row per reading (int key, real) | 116 | 825 ms | 2.3 s |
| **Hourly chunk + stats** | **4.6** | **1.3 ms** | **33 ms** |

Study of 100 participants × 30 days × 5 sensors (55 M readings, 254 MB of chunks + 33 MB of hourly stats):

| Operation | Time |
|---|---:|
| Ingest one full day as shuffled 15-min batches with ±2 s clock jitter | 16 s (~130 k readings/s), 12,000/12,000 chunks exact |
| 8 concurrent clients writing overlapping batches across hour boundaries | 99,478 transactions, 0 failures, 0 deadlocks |
| Timeline of 1 participant-day (sensors at 1 min + coverage + EMA + episodes) | 15–20 ms |
| `sensor_daily`, 1 participant, 30 days | 10 ms |
| `sensor_daily`, whole study, last 7 days | 140 ms, **same with 1 year of data** (130 ms) |
| ±5 min sensor context of each EMA answer, 1 participant (174 answers) | 20 ms |
| `sensor_daily`, whole study, 1 year (export) | 6.8 s, linear: run it as a job |

## Known limits / when to revisit

- **Multi-month, study-wide dashboards** are aggregated on the fly from `sensor_hourly`; if they become frequent, materialize a daily rollup per series.
- **Partition `sensor_chunks`/`sensor_hourly` by year** once they reach tens of millions of rows (100 participants ≈ 4.4 M rows/year each).
- **Half-hour UTC offsets:** the local day assumes whole-hour offsets (Chile is fine).
- **Production** needs the `btree_gist` extension (check that the Render plan allows it) and Postgres ≥ 15 (`UNIQUE NULLS NOT DISTINCT`, `date_trunc(..., 'UTC')`).
- **`identity` schema grants:** add an app role without access to `identity` once there are per-environment roles.
