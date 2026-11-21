# AGENTS.md

Shared context for every coding agent (and human) working on this repo. Keep it short, accurate and up to date: if you change an architectural decision or a contract, update this file in the same PR.

## 1. Project in one paragraph

We are building **Rigo**, a multimodal longitudinal observatory, for Platanus Hack 26 (Hardware track). It is scientific instrumentation, not a lifelogging gadget: a wearable pendant captures video and sensor data under a researcher-defined **observation protocol**, the participant reviews and approves what gets uploaded from an Android app, an AI pipeline cuts only the study-relevant segments of authentic footage and extracts **structured, protocol-defined variables**, and researchers explore and export them in a web portal. Every measurement is linked to its evidence and carries explicit **coverage and uncertainty**.

**Names:** the project and the participant Android app are **Rigo**, and the researcher web portal is **Rigo Lab**. Internal identifiers keep their old names until their owners rename them: the Android package `cl.observatorio.participante`, `@observatorio/db`, the `observatorio` database, the Render `olm-*` services and the `olm-<id>.local` pendant hostname. Never rename `olm-db` in `render.yaml`: Render would create a new, empty database.

**Demo vertical: eating episodes.** We detect when the participant eats or drinks, how often, for how long and in what observable context. We do **not** estimate calories, portion weight or nutrients.

## 2. Non-negotiable principles

1. **Evidence is never generated.** "Editing" video means selecting, cutting and concatenating authentic footage. No generative edits, no re-rendering of content. Every clip keeps a reference (file hash + start/end offsets) to its original.
2. **Absence of detection ≠ absence of behavior.** Every time window is either `observed` or has an explicit non-observed reason (see §5). Never report a zero for a window that wasn't observed.
3. **Every record is traceable.** Each observation stores `protocol_version`, `model_version`, `pipeline_version`, `device_id`, `firmware_version` and source evidence.
4. **Participant controls privacy.** Nothing leaves the phone before the participant reviews it. Excluded footage is recorded as an excluded interval (start, end), never its content.
5. **No overclaiming.** Model confidence is not a calibrated probability. Sound level from the KY-037 is not calibrated dB. MQ readings are relative context, not certified gas concentrations. Don't infer emotions, stress or intentions from video.
6. **One vertical, end to end.** Prefer a working, measurable flow over breadth.

## 3. Team and ownership

| Area | Owner | Path |
|---|---|---|
| Physical prototype, enclosure, design | Alendi | `hardware/`, `firmware/` |
| Android app (Kotlin), frontend polish | Mauri | `android/`, `web/` (UI) |
| Experiment data flow, evaluation | Pablo | `data/`, `worker/` |
| Problem justification, pitch, organization | Mari | `docs/` |
| Planning, backend, researcher app | Pedro | `web/`, `db/`, `worker/` |

Work is tracked in **Linear**. Personal research and decision notes live in each person's Obsidian vault (outside the repo); anything the rest of the team needs goes to `docs/decisions/`.

## 4. Architecture

```text
[Pendant]                         [Android app]                   [Backend on Render]
Arduino Uno (sensor hub) --UART--> ESP32-CAM                      web/ (Next.js)
  DHT11, MQ-7 (CO), MQ-2,           camera (JPEG frames), SD card   - ingestion API
  KY-037, RTC, buzzer, buttons      Wi-Fi HTTP API  ------------>   - researcher portal
                                    (status, time, sessions)        - Postgres
                                         |                              |
                                         v                              v  jobs table
                                    review -> exclude -> approve   worker/ (Node)
                                         |                          1. select relevant segments (agent + ffmpeg)
                                         +--- authorized upload --> 2. multimodal extraction -> structured JSON
                                                                    3. validate against data/schemas, store
```

### Hardware (`hardware/`, `firmware/`)

Full proposal in [`hardware/README.md`](./hardware/README.md); decision record in `docs/decisions/0001-prototype-hardware-architecture.md`.

- **Single chest-worn box (prototype):** size and power only constrain the prototype; production would be a custom pendant. Inside: ESP32-CAM (camera) + Arduino Uno (sensor hub) + 2S battery + LM2596 → 5 V.
- **The Uno is the sensor hub and master clock:** DHT11, MQ-7, MQ-2, KY-037, RTC, buzzer, event button, privacy switch, battery voltage. It sends checksummed ASCII lines to the ESP32-CAM over UART.
- **The ESP32-CAM** saves JPEG frames (2 fps, VGA) plus `frames.csv`, `sensors.csv`, `events.csv` and `session.json` per session on the microSD. It exposes a token-protected **HTTP API on the local network**: it joins the strongest known Wi-Fi (lab, home, phone hotspot), falls back to its own AP, and is reachable at `olm-<id>.local`. **No BLE in v0.**
- **Audio recording is undecided:** the KY-037 only gives a relative level, and the loose electret capsule needs a preamp plus a recorder. Options are in `hardware/README.md` §2. The phone microphone is ruled out because it breaks standardization.
- **The privacy switch physically cuts the pendant's power**, and the hub logs the interval.
- Open risks: GPIO12 strapping on the ESP32-CAM, brownouts when Wi-Fi starts, no IMU (no wear detection), and a small battery (two 260 mAh cells in series = 2S, ~35 min with everything on; bench work runs from a USB power bank).

### Android (`android/`)

Kotlin. Talks to the device over its HTTP API on the local network, with a bearer token shared at pairing time (BLE is a stretch goal). It shows device status (battery, storage, recording, sensors), syncs the clock, starts and stops sessions, downloads them, lets the participant review, trim or exclude, encodes the approved frames to H.264 and uploads that session bundle plus the excluded intervals (contract: [ADR 0002](./docs/decisions/0002-contracts-v0.md)).

**Top priorities: it must look native and be fast.** Use Jetpack Compose with stock Material 3 components, edge-to-edge and predictive back. The brand is applied only through the theme (see [`android/design/GUIDELINES.md`](./android/design/GUIDELINES.md)). No custom-drawn widgets and no heavy UI or animation libraries. UI text is Spanish only. Keep BLE, network and file I/O off the main thread. Add dependencies only when the platform can't do the job.

### Backend stack (npm workspaces, Node 24, TypeScript)

Local setup, commands and gotchas are in [`DEVELOPMENT.md`](./DEVELOPMENT.md).

- **`db/`**: the shared Drizzle ORM schema (one module per area in `db/src/schema/`, re-exported by `db/src/schema.ts`), its migrations and the sensor-series helpers, imported by `web` and `worker` as `@observatorio/db`. Edit the schema, then run `npm run db:generate` and commit the migration. Rules Drizzle can't express (no-overlap constraints, immutability triggers, SQL functions, views) live in custom migrations and are covered by `npm run db:test`. See [`db/README.md`](./db/README.md). Only one person generates migrations at a time.
- **`storage/`**: the object storage client (`@observatorio/storage`) shared by `web` and `worker`: presigned PUT/GET, HEAD, streamed GET, delete (every version) and the ADR 0002 key builders. Configured by the `S3_*` env vars.
- **`web/`**: Next.js 16 (App Router, Cache Components) + Tailwind. It serves as the **API** (`/api/*`: ingestion from Android, protocol config, job enqueueing) and as the **researcher portal** (studies and protocols, timelines, evidence viewer, coverage, CSV/JSON export). Read `web/AGENTS.md` before touching Next.js code: the version has breaking changes. Any route that reads the DB must call `await connection()`.
- **`worker/`**: a background worker that claims rows from the Postgres `jobs` table (`FOR UPDATE SKIP LOCKED`), dispatches on `job.type` and marks each job `done` or `failed`. This is where the video pipeline runs, because it is slow and needs `ffmpeg`:
  1. **Segment selection:** a headless coding agent (OpenCode or similar), spawned as a subprocess, runs a video-editing skill backed by `ffmpeg`. Guided by the study protocol, it outputs an edit list (EDL) and cut clips of the relevant moments, with some context before and after. Skills live in `worker/skills/`.
  2. **Extraction:** a multimodal LLM interprets the selected clips together with the aligned sensor data and returns JSON matching `data/schemas/observation`.
  3. **Validation and storage:** the worker validates the schema, adds provenance fields and writes the results through `@observatorio/db`.
- Media files go to S3-compatible object storage through presigned PUT URLs (Backblaze B2 bucket `olm-media-epoqpl` in production, MinIO from `docker-compose.yml` locally; see ADR 0002), through `@observatorio/storage`. Postgres only stores metadata and references.
- Model and provider choices are TBD. Record them in `docs/decisions/` once they're picked.

### Deploy notes

Render can't connect to this org repo, so deploys run from a personal mirror managed by Mauri. Pushing to both repos at once:

```bash
git remote set-url --add --push origin https://github.com/platanus-hack/platanus-hack-26-cl-team-21.git
git remote set-url --add --push origin https://github.com/<user>/<mirror-repo>.git
```

Infrastructure is declared in the `render.yaml` Blueprint: `olm-web` (web, free plan), `olm-worker` (background worker, starter plan) and `olm-db` (Postgres, free plan, expires after ~30 days). Both services build from the repo root using npm workspaces, and migrations run when `olm-web` starts. If you add a service or env var, update `render.yaml` and `.env.example` (a single root `.env` is shared by all Node workspaces). The worker will need `ffmpeg` and the agent CLI available at runtime: check that the Render Node runtime provides them, or switch `olm-worker` to Docker.

## 5. Data contracts

There are two sources of truth:

- **Database tables:** `db/src/schema/` (Drizzle) plus the custom migrations in `db/migrations/`. Conventions and design notes are in `db/README.md`.
- **Interchange formats** between firmware, Android, worker and LLM output: the JSON Schemas in `data/schemas/`.

Change either one deliberately and update every consumer in the same PR.

The phone → backend contracts (enrollment, upload API v0, session bundle, storage keys, coverage derivation and how they map to tables) are fixed in [`docs/decisions/0002-contracts-v0.md`](./docs/decisions/0002-contracts-v0.md).

- **`sensor_sample`**: `device_id`, `timestamp`, `sensor`, `value`, `unit`, `firmware_version`.
- **`device_event`**: battery level, charging, privacy switch on/off, button press, storage full, sensor fault.
- **`clip_manifest`**: `clip_id`, `device_id`, `started_at`, `ended_at`, `sha256`, `storage_uri`, `approved_by_participant`. Superseded by the session bundle in ADR 0002.
- **`coverage_interval`**: `participant_id`, `start`, `end`, `status` ∈ `observed | excluded_by_participant | privacy_switch | device_off | low_battery | no_upload | low_quality`.
- **`observation`** (one detected event):

```json
{
  "study_id": "study-eating-001",
  "participant_id": "p-019",
  "protocol_version": "eating-v1",
  "pipeline_version": "0.1.0",
  "model_version": "TBD",
  "event_type": "eating_episode",
  "started_at": "2026-11-21T14:05:12-03:00",
  "ended_at": "2026-11-21T14:12:08-03:00",
  "duration_seconds": 416,
  "attributes": { "episode_kind": "meal", "visible_items": ["sandwich", "water"], "context": "seated_table" },
  "evidence": [{ "clip_id": "clip-072", "source_sha256": "…", "start_second": 124, "end_second": 540 }],
  "confidence": 0.8,
  "coverage_status": "observed",
  "human_review_status": "pending",
  "sensor_context": { "ambient_temperature_c": 23.4, "relative_humidity_pct": 47, "sound_level_raw": 512 }
}
```

Conventions: timestamps are ISO 8601 with an offset (device side: epoch ms from the RTC), IDs are pseudonymous strings, and units go in field names or `unit` fields.

## 6. Demo and evaluation

A volunteer wears the pendant through a scripted session with eating episodes, distractors (e.g. handling food without eating, drinking) and non-observed periods (privacy switch, excluded clip). Independent annotators label the ground truth from the script/full footage. We report **precision, recall, F1, count error, start/end time error, coverage**, and run the pipeline twice to show consistency. Evaluation code and annotations live in `data/`.

## 7. Conventions

- **Language:** everything in English (code, docs, commits, PRs, issues).
- **Commits:** Conventional Commits (`feat(web): …`, `fix(firmware): …`). Scope = top-level folder.
- **Branches:** `<github-user>/<short-topic>`; include the Linear issue ID when there is one.
- **PRs:** small, one component when possible; mention any contract change explicitly.
- **PR titles and bodies:** title `[MON-n] <conventional commit>`. The body follows `.github/pull_request_template.md` and has no AI attribution lines (no "Generated with Claude Code").
- **Linear links:** Linear's GitHub integration isn't installed on this org, so PRs don't link themselves. Whoever opens a PR (person or agent) adds its URL as a link on the Linear issue (WorktreeManager reads PRs from there), and moves the issue to Done when the PR merges.
- **Secrets:** never commit `.env` files or keys; provide `.env.example` per service.
- **Setup docs:** backend/Android setup lives in `DEVELOPMENT.md`. Firmware/hardware get their own short `README.md` with build/flash instructions.
- **Decisions:** short ADR-style notes in `docs/decisions/NNNN-title.md` (context, decision, consequences).
- When unsure about scope or a contract, ask the owner. We sit together.
