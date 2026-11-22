# Development

| Folder | What | Stack |
|---|---|---|
| `web/` | Researcher portal + API (`/api/*`) | Next.js, TypeScript |
| `worker/` | Background processing (video, AI) that consumes the `jobs` table | Node, TypeScript (tsx) |
| `db/` | Schema and migrations shared by `web` and `worker` | Drizzle ORM, Postgres |
| `storage/` | Object storage client shared by `web` and `worker` | AWS SDK v3 (S3 API) |
| `android/` | Participant app | Kotlin, Jetpack Compose |
| `render.yaml` | Render Blueprint: `olm-web`, `olm-worker`, `olm-db` | Render |

## Web + worker locally

Local Postgres with Homebrew (once):

```bash
brew install postgresql@17 && brew services start postgresql@17
"$(brew --prefix postgresql@17)/bin/createdb" observatorio
```

Prefer Docker? `docker compose up -d postgres` and use the alternative URL in `.env.example`.

Object storage runs in Docker either way: `docker compose up -d minio minio-init` starts MinIO on `localhost:9000` (console on `:9001`, `minioadmin`/`minioadmin`) and creates the `olm-media` bucket. The defaults in `.env.example` point at it. Presigned URLs are signed against the host in `S3_ENDPOINT`, which an Android emulator can't reach as `localhost`. Either run `adb reverse tcp:9000 tcp:9000` (the emulator's `localhost:9000` then reaches MinIO; nothing else to configure), or start the web app with `S3_PUBLIC_ENDPOINT=http://10.0.2.2:9000 npm run dev:web` (use `http://<your-LAN-IP>:9000` for a physical phone). Don't put `S3_PUBLIC_ENDPOINT` in `.env`: `npm run test -w web` PUTs to those URLs from the host. The upload API rejects a `device_id` that isn't in `devices`, so register the pendant first (the demo mode's fake pendant is `3c71bf`: `insert into devices (serial, hardware_revision, form_factor) values ('3c71bf','demo','pendant')`). `npm run storage:test:integration` checks the round trip (presigned PUT, HEAD, GET, delete) against whatever `S3_*` points to.

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run db:seed                # optional: demo eating study (idempotent, safe to re-run)
npm run dev:web               # http://localhost:3000/api/health
npm run dev:worker
curl -X POST localhost:3000/api/jobs   # the worker prints "hello from worker"
```

Changing the schema: edit the module for that area in `db/src/schema/`, then `npm run db:generate` and commit the migration in `db/migrations/`. Rules Drizzle can't express (no-overlap constraints, triggers, SQL functions) go in a custom migration; see [`db/README.md`](db/README.md). `npm run db:test` checks those rules against your database (rolled back).

`npm run test -w web` runs the API route tests (`web/src/**/*.test.ts`, `node:test` through `tsx`) against the database in `DATABASE_URL`. They insert their own study and participants with random codes and leave them there, so point it at a local or CI database, never production.

## Android

Open `android/` in Android Studio and run it on the emulator. Debug builds call the mock backend at `http://10.0.2.2:4010`: start it with `npm run mock:api` (enrollment and upload API v0; codes `EAT-001-P01`…`P03` work, `EAT-001-P00` is already used; see [`tools/mock-api/README.md`](tools/mock-api/README.md)). For the real backend: `./gradlew installDebug -PapiBaseUrl=http://10.0.2.2:3000` (the host's `npm run dev:web`) or `-PapiBaseUrl=https://...`.

CI runs the Android unit tests. Run the video encoder tests on a connected Android device or emulator from `android/`: `./gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=cl.observatorio.participante.video.Mp4EncoderTest`.

## Deploy

Render only deploys from repos you own: set up the personal mirror described in `AGENTS.md` (Deploy notes) and create a Blueprint pointing at `render.yaml`. Migrations run when `olm-web` starts.

## Notes

- `web/` uses Cache Components (Next 16): a page or route handler that reads the DB must call `await connection()` (from `next/server`) or be inside `<Suspense>`; otherwise `next build` fails or tries to query the DB at build time, which has no access to it on Render.
- Only one person at a time generates migrations (`npm run db:generate`); two parallel `0001_*` files collide in `db/migrations/meta/_journal.json`.
- On Render's free plan `olm-web` sleeps after ~15 min; the first request takes 30–60 s.
- Production storage is the private B2 bucket `olm-media-epoqpl` (CORS allows presigned PUT/GET/HEAD from any origin; hidden file versions are purged after a day). Its bucket-scoped key is set in the Render dashboard; ask the backend owner for a local copy. B2 keeps old versions on a plain S3 delete, so always delete through `storage.delete()`, which removes every version.
- CI (`.github/workflows/ci.yml`) runs each job only when the PR touches its files: `web` (lint, build, route tests against a migrated Postgres), `db` (migration checks, rule tests, seed), `storage` (typecheck, key and delete tests; the MinIO round trip is local only), `mock-api` (tests) and `android` (build, lint). Editing the workflow runs them all.
- `npm install` turns on a pre-push hook (`.githooks/pre-push`) with light versions of the CI checks for the areas the push changes: eslint on changed `web` files, migration checks for `db`, the `storage` unit tests and the mock API tests. Android and the web build are left to CI. Skip it with `git push --no-verify`.

## Session pipeline (`process_session`)

The worker turns an uploaded session video into observations (`worker/src/process-session/`). It downloads `video.mp4` and `frames.csv` from object storage (the `S3_*` vars), or reads `<LOCAL_MEDIA_DIR>/<upload_id>/video.mp4` and `frames.csv` when `LOCAL_MEDIA_DIR` is set; the declared video and frame timeline hashes must match the bundle.

```bash
npm test -w worker            # unit + DB tests, Claude mocked (DB tests need a migrated, seeded DATABASE_URL)
npm run typecheck -w worker
npm run smoke -w worker       # ONE real run: synthetic 25 s video, seeded participant P-001, needs ANTHROPIC_API_KEY
npm run smoke -w worker -- path/to/video.mp4 path/to/frames.csv   # same, with a real session
```

The smoke run prints the observations, the number of calls and the tokens per pass.

CI typechecks the worker and runs those tests with seeded Postgres. The pre-push hook typechecks the worker when it changes.
