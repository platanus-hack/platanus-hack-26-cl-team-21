# 0002 — Contracts v0: enrollment, upload and session bundle

**Status:** proposed · **Owner:** Pedro · **Date:** 2026-11-21

## Context

The Android app, the researcher portal and the worker need fixed interfaces before the real backend exists, so each can build against a mock. The device side is fixed by `hardware/README.md` §7: per session, the ESP32-CAM writes JPEG frames at 2 fps plus `session.json`, `frames.csv`, `sensors.csv` and `events.csv`. The database schema is in `db/src/schema/`. This ADR fixes how a reviewed session travels from the phone to the backend and how it lands in those tables.

## Decision

### 1. Session bundle (phone → backend)

After review, the phone uploads one bundle per device session (or per approved part of one). It contains five files:

| `kind` | File | Content |
|---|---|---|
| `video` | `video.mp4` | H.264, encoded on the phone from the device JPEG frames. Variable frame rate: each frame keeps its real timestamp, so `pts = (rtc_epoch_ms − first_frame_epoch_ms) / 1000`. A keyframe at least every 2 s, plus one on the first frame after every gap, so the worker can cut clips without re-encoding (e.g. `MediaCodec` `KEY_I_FRAME_INTERVAL = 2`; ffmpeg `-force_key_frames "expr:gte(t,n_forced*2)"`). No audio track. |
| `frames` | `frames.csv` | `seq,rtc_epoch_ms,uptime_ms,bytes` as written by the device, keeping only the rows of the frames that are in `video.mp4` (row *i* = video frame *i*). |
| `sensors` | `sensors.csv` | As written by the device (`rtc_epoch,uptime_ms,temp_c,rh_pct,mq7,mq2,sound_p2p,batt_mv`), minus the rows inside excluded intervals. |
| `events` | `events.csv` | As written by the device (`rtc_epoch,uptime_ms,type,value`), minus the rows inside excluded intervals except `PRIVACY_ON`/`PRIVACY_OFF`. |
| `manifest` | `manifest.json` | The device `session.json` verbatim, phone info, the excluded intervals and the sha256 of every other file. |

**Excluded content never leaves the phone.** An excluded interval drops everything in that time range, not only footage: the phone removes its frames (so they are not in the video), sensor rows and events before hashing, and only the `[start, end)` interval is sent. `PRIVACY_ON`/`PRIVACY_OFF` events are always kept: they carry no content and coverage needs them. Other events and sensor rows are matched against excluded ranges by `rtc_epoch`. Frames with `rtc_epoch_ms` empty, 0 or not increasing (RTC lost or reset) are dropped too and show up as a gap. Sessions recorded before the first clock sync are not uploadable in v0.

`manifest.json` example:

```json
{
  "manifest_version": "0",
  "upload_id": "6f1c2a9e-4b7d-4e2a-9c51-0d3e8f7a1b24",
  "device_session_id": "a1b2c3-1795280400",
  "device_session": {
    "session_id": "a1b2c3-1795280400",
    "device_id": "a1b2c3",
    "firmware_version": "cam-0.1.0",
    "protocol_version": "eating-v1",
    "fps": 2,
    "frame_size": "VGA",
    "started_at_epoch_ms": 1795280400000,
    "ended_at_epoch_ms": 1795282200000,
    "frames": 3600
  },
  "phone": { "app_version": "0.1.0", "os": "Android 15", "model": "Pixel 8" },
  "recorded_from": "2026-11-21T14:00:00.000-03:00",
  "recorded_to": "2026-11-21T14:30:00.000-03:00",
  "excluded_intervals": [
    { "start": "2026-11-21T14:12:00.000-03:00", "end": "2026-11-21T14:15:30.000-03:00" }
  ],
  "files": [
    { "kind": "video", "name": "video.mp4", "sha256": "9b74c9897bac770ffc029102a200c5de…", "bytes": 18234567 },
    { "kind": "frames", "name": "frames.csv", "sha256": "e3b0c44298fc1c149afbf4c8996fb924…", "bytes": 98213 },
    { "kind": "sensors", "name": "sensors.csv", "sha256": "2c26b46b68ffc68ff99b453c1d304134…", "bytes": 71520 },
    { "kind": "events", "name": "events.csv", "sha256": "fcde2b2edba56bf408601fb721fe9b5c…", "bytes": 412 }
  ]
}
```

`recorded_from`/`recorded_to` bound the recorded session (or the part this bundle covers): the first and last frame in the device `frames.csv`, before exclusions. The video itself starts at the first uploaded frame. The manifest cannot hold its own hash; that one is sent only in `POST /api/v1/uploads`. The `excluded_intervals` in the manifest and in the `complete` call must be identical.

### 2. API v0

API v0 (Next.js route handlers under `/api/v1`, JSON, `Authorization: Bearer <participant_token>` except enrollment):

* `POST /api/v1/enrollments` with `{ "code": "EAT-001-P01", "device_id"?: "a1b2c3" }`. Returns 201 `{ "participant_id", "study_id", "protocol_version", "participant_token" }`, 404 if the code is unknown, 409 if it was already used.
* `POST /api/v1/uploads` with `{ "upload_id": "<client uuid>", "device_id", "firmware_version", "device_session_id", "recorded_from", "recorded_to", "files": [{ "kind": "video|frames|sensors|events|manifest", "sha256", "bytes", "content_type" }] }`. Returns 201 `{ "upload_id", "files": [{ "kind", "put_url", "expires_at" }] }`. It is idempotent on `upload_id` (same body returns 200 with fresh URLs).
* `POST /api/v1/uploads/{upload_id}/complete` with `{ "excluded_intervals": [{ "start", "end" }] }`. Returns 202 `{ "upload_id", "status": "processing", "job_id" }`. The server checks the objects exist with matching size, ingests sensors/events, writes coverage and enqueues a `process_session` job. Returns 409 if files are missing.
* `GET /api/v1/uploads/{upload_id}`. Returns `{ "upload_id", "status": "awaiting_files|processing|processed|failed", "error"? }`.

Timestamps are ISO 8601 with an offset, ids are UUIDs generated on the client, and errors are `{ "error": { "code", "message" } }`.

Notes for implementers:

- Only `upload_id` is a client-generated UUID; every other id (`participant_id`, `study_id`, `job_id`) is an opaque string. The mock returns e.g. `p-01` and `study-eating-001`.
- Error codes: 400 `invalid_request`, 401 `unauthorized`, 404 `enrollment_code_not_found`, `upload_not_found` (also for another participant's upload) and `not_found`, 409 `enrollment_code_used`, `upload_conflict`, `files_missing` and `files_mismatch`. A failed upload reports `error.code` `processing_failed` or `files_mismatch`. Clients must handle `files_mismatch` both as a 409 from `complete` (the mock checks hashes there) and as a `failed` status.
- `files` is a set of distinct kinds. The real server requires `sensors`, `events` and `manifest`, and `video` and `frames` come together or not at all (400 `invalid_request` otherwise). An upload without `video` (a whole clip excluded) creates no `media_assets` row; its range gets coverage `no_upload`.
- The same `POST /uploads` body always returns 200 with fresh URLs, even after `complete`. The same `upload_id` with a different body or participant returns 409 `upload_conflict`, and so does a range that overlaps another upload of the same participant (coverage allows one status per instant; the MON-11 mock does not enforce this).
- Repeating `complete` returns 202 with the current status and the same `job_id`. A `failed` upload is retried under a new `upload_id`. Before accepting it, the server deletes the failed upload's coverage and device events (by `batch_id`) and its `media_assets` row (`id` = the failed `upload_id`) with its storage object, because `media_assets.sha256` is globally unique. If observation evidence references that row, it is kept and reused instead. The failed `sync_batches` row stays, with status `failed`, for traceability. Sensor readings merge idempotently on re-ingest, and the overlap check ignores failed uploads.
- `device_id` is the device's own id (`a1b2c3`, from `session.json`), resolved to `devices.serial`. An unknown device returns 400 `invalid_request`. v0 does not check that the device is assigned to the participant: any enrolled participant can upload under any registered device (accepted for v0; revisit before real participants).
- `job_id` is an opaque string generated by the server (the real one sends `jobs.id`, an integer, as a string). Clients must not parse it.
- `content_type`: `video/mp4`, `text/csv`, `application/json`.

### 3. Storage

S3-compatible object storage with **presigned PUT URLs**: the phone uploads straight to the bucket and the API never proxies media. **Backblaze B2** (S3 API) in production, **MinIO** for local development. The bucket is private and upload URLs expire after 15 minutes: a late PUT to an old URL could otherwise leave an orphan object after a retry has deleted a failed upload.

- Keys: `uploads/<study_id>/<participant_id>/<upload_id>/<kind>.<ext>` (`video.mp4`, `frames.csv`, `sensors.csv`, `events.csv`, `manifest.json`). Clips go under `clips/<observation_id>.mp4`: one file per observation, concatenating its evidence cuts.
- Integrity: `complete` checks that each object exists with the declared size (`HEAD`) and stores the client's sha256. The worker verifies the sha256 when it downloads the files; a mismatch fails the upload with `files_mismatch`.
- Clips are cuts of `video.mp4` (stream copy at keyframes), derived from `observation_evidence`, so they need no row of their own. They are a cache: when the purge job deletes a video, it also deletes the clips of every observation with evidence in that video.

### 4. Enrollment and token

- The research team creates one single-use code per participant (`EAT-001-P01`). The participant enters it once in the app.
- The server returns an opaque random `participant_token` (32 bytes, base64url) and stores only its sha256. The token authenticates every later call. It does not expire in v0; revoking it means clearing the hash.
- If `device_id` is sent, the server closes any open `device_assignments` row of that device and opens one for the participant starting now. An unknown device returns 400 `invalid_request`.
- `protocol_version` is the `version_label` of the participant's current `participant_protocols` row.

### 5. Coverage derivation

On `complete`, the server writes `coverage_intervals` for `[recorded_from, recorded_to)` with `batch_id = upload_id`. Every interval is clipped to that range and they never overlap (enforced by the DB). Precedence:

1. `PRIVACY_ON`/`PRIVACY_OFF` intervals from `events.csv` (using the real switch time in `value`) → `privacy_switch`, source `device`.
2. Excluded intervals → `excluded_by_participant`, source `app`.
3. Time covered by uploaded frames → `observed`, source `derived`. Consecutive frames more than 2 s apart leave a gap.
4. Any remaining gap inside the range (camera brownout, dropped frames) → `device_off`, source `derived`. An upload without video → `no_upload` for its whole range, after steps 1–2.

Everything else stays non-observed: time outside any upload has no row, and the portal shows it as not observed, never as zero. Retrying `complete` replaces that upload's rows.

### 6. What the portal reads

No new API in v0: the portal reads the DB server-side through the existing tables, views and functions in `db/`: `v_current_observations`, `coverage_intervals`, `sensor_window_stats()` and `sensor_daily()`, plus `v_media_retention` for the evidence viewer.

### 7. Field → table mapping

| Contract field | Table.column | Notes |
|---|---|---|
| `upload_id` | `sync_batches.id`, `media_assets.id` (video) | One video per upload, so the upload id doubles as the video's id |
| `device_id` | `sync_batches.device_id`, `media_assets.device_id`, `device_events.device_id` | Resolved through `devices.serial` |
| `firmware_version` | `sync_batches.firmware_version`, `media_assets.firmware_version`, `device_events.firmware_version` | |
| `recorded_from` / `recorded_to` | `sync_batches.recorded_from/to` | Session bounds, also the coverage range |
| first / last row of the uploaded `frames.csv` | `media_assets.recorded_from/to` | The video timeline: device time = `recorded_from` + `observation_evidence.start_second` |
| `files[kind=manifest].sha256` | `sync_batches.payload_sha256` | Unique per upload (the manifest holds `upload_id`); duplicate sessions are caught by the overlap check instead |
| upload key prefix | `sync_batches.raw_storage_key` | `uploads/<study_id>/<participant_id>/<upload_id>/` |
| `files[kind=video]` | `media_assets` (`sha256`, `size_bytes`, `mime_type`, `storage_key`, `kind = 'video'`) | Row created on `complete`; `base_retain_until` = `uploaded_at` + `studies.media_retention_days`. Deleted when a failed upload is retried, unless observation evidence references it |
| `manifest.phone.app_version` | `sync_batches.app_version` | |
| participant (from token) | `sync_batches.participant_id`, `media_assets.participant_id`, `coverage_intervals.participant_id` | |
| `sensors.csv` | `sensor_series` + `sensor_chunks` / `sensor_hourly` via `ingest_sensor_readings()` | `temp_c` → `temperature_c`, `rh_pct` → `humidity_pct`, `mq7` → `co_raw`, `mq2` → `flammable_gas_raw`, `sound_p2p` → `sound_level_raw`, `batt_mv` → `battery_mv`. Empty values (e.g. a failed DHT read) and `batt_mv` = -1 (external power) are skipped, not stored |
| `events.csv` | `device_events` (`batch_id = upload_id`) | `id` = UUIDv5 of `(device_id, rtc_epoch, uptime_ms, type)` (`uptime_ms` may be empty). `occurred_at` = `value` for `PRIVACY_*` (real switch time), else `rtc_epoch` (seconds). `PRIVACY_ON/OFF` → `privacy_switch_on/off`, `BUTTON` → `button_press`, `LOW_BATT`/`CRIT_BATT` → `low_battery` (original type in `payload`), `DHT_FAIL` → `sensor_fault`, `BOOT` → `boot`, `RTC_SET` → `rtc_set` (old epoch in `payload`), `RTC_LOST` → `rtc_lost`, `CAM_BOOT` → `camera_boot` (`value` in `payload`) |
| `excluded_intervals` | `coverage_intervals` (`excluded_by_participant`, source `app`) | |
| `job_id` | `sync_batches.job_id` → `jobs.id` (`type = 'process_session'`, `payload = { "upload_id" }`) | `pipeline_runs.job_id` links the run back |
| `device_session_id` | `sync_batches.device_session_id` | Not unique: a session can be split into several bundles, and a failed upload is retried under a new `upload_id` |
| `files[]` (`kind`, `sha256`, `bytes`, `content_type`) | `sync_batch_files` (`kind`, `sha256`, `size_bytes`, `content_type`) | One row per kind, written by `POST /uploads` and checked by `complete` and the worker |
| upload `status` | `sync_batches.status` | `awaiting_files` → `processing` (on `complete`) → `processed` / `failed` |
| upload `error` (`code`, `message`) | `sync_batches.error_code`, `sync_batches.error_message` | `error_code` is set if and only if `status = 'failed'` |
| `complete` accepted at | `sync_batches.completed_at` | Set if and only if `status` is not `awaiting_files` |
| enrollment `code` | `participants.enrollment_code` (unique), `participants.enrollment_code_used_at` | Used once: the server sets `enrollment_code_used_at` and returns 409 if it is already set |
| `participant_token` | `participants.token_sha256` (unique, hex) | Only the hash is stored; revoking clears it |
| enrollment `participant_id`, `study_id` | `participants.id`, `studies.id` | |

### 8. Phase-2 schema gaps

Migration `0003_enrollment_and_uploads` (MON-20) closes the schema gaps; the columns are in the §7 mapping:

- **Enrollment:** `participants.enrollment_code`, `enrollment_code_used_at` and `token_sha256`.
- **Upload state:** `sync_batches.status`, `error_code`, `error_message`, `completed_at` and `job_id`, plus the `sync_batch_files` table for the declared files. Batches stored before the migration are marked `processed`.
- **Device session:** `sync_batches.device_session_id`.
- **Event kinds:** `boot`, `rtc_set`, `rtc_lost` and `camera_boot` on `device_events.kind`.
- **Sensor types:** the migration inserts the pendant's `sensor_types` (`temperature_c`, `humidity_pct`, `co_raw`, `flammable_gas_raw`, `sound_level_raw`, `battery_mv`), so they exist without the demo seed.

Still open, as application logic rather than schema: ingestion needs a `device_sensors` row per pendant component and a `sensor_series` (period 1 s) per participant and sensor, created when a device is registered or assigned.

## Consequences

- The phone encodes video. This replaces decision 3 of [0001](./0001-prototype-hardware-architecture.md) ("the worker builds the MP4"): uploading thousands of JPEGs is slower and costlier than one H.264 file, and the frame timestamps survive in `frames.csv` and the VFR timeline.
- Evidence offsets (`observation_evidence.start_second/end_second`) are seconds on the `video.mp4` timeline, which maps 1:1 to device time through `frames.csv`.
- MON-11's mock API and the Android app can be built against §2 now. The real routes can use the phase-2 columns (§8) from migration 0003 on.
- Storage needs `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`. Add them to `.env.example` and `render.yaml` with the implementation.
- `sensors.csv` and `events.csv` are filtered by the phone, so they are no longer byte-identical to the device files; their hashes in the manifest are of the uploaded files.
- This bundle replaces the `clip_manifest` contract in AGENTS.md §5: an upload's video is the clip (`media_assets`).
