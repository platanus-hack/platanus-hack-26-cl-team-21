# Mock API

A local stand-in for the backend API v0 (enrollment and upload), so the Android app can integrate before the real backend exists. It uses only Node 24 built-ins and keeps everything in memory: restarting it forgets enrollments and uploads.

```bash
npm run mock:api        # from the repo root
npm run mock:api:test   # node --test
```

It listens on `0.0.0.0`, so a phone on the same Wi-Fi can reach it at `http://<mac-lan-ip>:4010` (the server prints its LAN addresses on start). The emulator reaches it at `http://10.0.2.2:4010`. Point the app at it with `./gradlew installDebug -PapiBaseUrl=http://<mac-lan-ip>:4010`.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4010` | Listening port |
| `MOCK_API_DATA_DIR` | `tools/mock-api/.data` | Where uploaded files are saved (gitignored) |
| `MOCK_API_PROCESSING_DELAY_MS` | `3000` | Time an upload stays `processing` before it becomes `processed` |

## Enrollment codes

| Code | Result |
|---|---|
| `EAT-001-P01`, `EAT-001-P02`, `EAT-001-P03` | 201 the first time (participants `p-01`..`p-03`), 409 afterwards |
| `EAT-001-P00` | Already used: always 409 |
| anything else | 404 |

All codes belong to `study-eating-001` with protocol `eating-v1`.

## Endpoints

| Request | Success |
|---|---|
| `POST /api/v1/enrollments` | 201 `{ participant_id, study_id, protocol_version, participant_token }` |
| `POST /api/v1/uploads` | 201 `{ upload_id, files: [{ kind, put_url, expires_at }] }`; the same body again returns 200 with fresh URLs |
| `PUT <put_url>` | 200; saves the body under `uploads/<study_id>/<participant_id>/<upload_id>/<kind>.<ext>` |
| `POST /api/v1/uploads/{upload_id}/complete` | 202 `{ upload_id, status: "processing", job_id }` |
| `GET /api/v1/uploads/{upload_id}` | 200 `{ upload_id, status, error? }`, `awaiting_files` → `processing` → `processed` |

Every call except enrollment and the PUT needs `Authorization: Bearer <participant_token>`. The PUT URLs point back to the mock, built from the request `Host` header, and are valid for one hour. Creating the same upload again invalidates the previous URLs. Complete checks that every declared file exists with the declared size and sha256. The complete body is optional (no body means no excluded intervals). Completing an already completed upload returns 202 with its current status.

To exercise the failure path, use a `device_session_id` that starts with `fail`: the upload ends as `failed` with `error: { code: "processing_failed", message }`.

## Errors

Every error is `{ "error": { "code", "message" } }`.

| Status | Code | When |
|---|---|---|
| 400 | `invalid_request` | Malformed JSON, missing or invalid field, `upload_id` not a UUID, timestamp without offset |
| 401 | `unauthorized` | Missing or unknown bearer token |
| 403 | `invalid_signature` | PUT URL signature does not match, or it was replaced by a newer one |
| 403 | `url_expired` | PUT URL has expired |
| 404 | `enrollment_code_not_found` | Unknown enrollment code |
| 404 | `upload_not_found` | Unknown `upload_id`, or it belongs to another participant |
| 404 | `object_not_found` | PUT to a storage key that was never issued |
| 404 | `not_found` | Unknown route |
| 409 | `enrollment_code_used` | Enrollment code was already used |
| 409 | `upload_conflict` | `upload_id` reused with a different body or by another participant |
| 409 | `files_missing` | Complete called before every file was uploaded |
| 409 | `files_mismatch` | An uploaded file's size or sha256 differs from the declared one |
| 409 | `upload_already_completed` | PUT after the upload was completed |

## Curl walkthrough

Run it from the repo root in a second terminal while `npm run mock:api` is running. It needs `curl` and `node` only.

```bash
API=http://localhost:4010
json() { node -pe "JSON.parse(require('fs').readFileSync(0, 'utf8'))$1"; }

mkdir -p tools/mock-api/.data/sample && cd tools/mock-api/.data/sample
printf 'fake video' > video.mp4
printf 'frame_ts\n1795280400000\n' > frames.csv
printf '{"device_session_id":"s-0001"}' > manifest.json
file_entry() { printf '{"kind":"%s","sha256":"%s","bytes":%s,"content_type":"%s"}' "$1" "$(shasum -a 256 "$2" | cut -d' ' -f1)" "$(wc -c < "$2" | tr -d ' ')" "$3"; }

TOKEN=$(curl -s -X POST $API/api/v1/enrollments -H 'content-type: application/json' \
  -d '{"code":"EAT-001-P01","device_id":"a1b2c3"}' | json .participant_token)

UPLOAD_ID=$(node -p 'crypto.randomUUID()')
CREATED=$(curl -s -X POST $API/api/v1/uploads -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{
  \"upload_id\": \"$UPLOAD_ID\", \"device_id\": \"a1b2c3\", \"firmware_version\": \"0.1.0\", \"device_session_id\": \"s-0001\",
  \"recorded_from\": \"2026-11-21T14:00:00-03:00\", \"recorded_to\": \"2026-11-21T14:30:00-03:00\",
  \"files\": [$(file_entry video video.mp4 video/mp4), $(file_entry frames frames.csv text/csv), $(file_entry manifest manifest.json application/json)]
}")

curl -s -X PUT --data-binary @video.mp4 "$(echo "$CREATED" | json '.files[0].put_url')" -w '%{http_code}\n'
curl -s -X PUT --data-binary @frames.csv "$(echo "$CREATED" | json '.files[1].put_url')" -w '%{http_code}\n'
curl -s -X PUT --data-binary @manifest.json "$(echo "$CREATED" | json '.files[2].put_url')" -w '%{http_code}\n'

curl -s -X POST $API/api/v1/uploads/$UPLOAD_ID/complete -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"excluded_intervals":[{"start":"2026-11-21T14:10:00-03:00","end":"2026-11-21T14:12:00-03:00"}]}'; echo
curl -s $API/api/v1/uploads/$UPLOAD_ID -H "authorization: Bearer $TOKEN"; echo   # processing
sleep 4
curl -s $API/api/v1/uploads/$UPLOAD_ID -H "authorization: Bearer $TOKEN"; echo   # processed
```
