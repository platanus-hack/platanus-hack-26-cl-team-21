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

Object storage runs in Docker either way: `docker compose up -d minio minio-init` starts MinIO on `localhost:9000` (console on `:9001`, `minioadmin`/`minioadmin`) and creates the `olm-media` bucket. The defaults in `.env.example` point at it. `npm run storage:test:integration` checks the round trip (presigned PUT, HEAD, GET, delete) against whatever `S3_*` points to.

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

## Android

Open `android/` in Android Studio and run it on the emulator; by default it calls `http://10.0.2.2:3000` (the host's `npm run dev:web`). For another backend: `./gradlew installDebug -PapiBaseUrl=https://...`.

No backend yet? `npm run mock:api` serves the enrollment and upload API v0 on port 4010; see [`tools/mock-api/README.md`](tools/mock-api/README.md).

CI runs the Android unit tests. Run the video encoder tests on a connected Android device or emulator from `android/`: `./gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=cl.observatorio.participante.video.Mp4EncoderTest`.

## Deploy

Render only deploys from repos you own: set up the personal mirror described in `AGENTS.md` (Deploy notes) and create a Blueprint pointing at `render.yaml`. Migrations run when `olm-web` starts.

## Notes

- `web/` uses Cache Components (Next 16): a page or route handler that reads the DB must call `await connection()` (from `next/server`) or be inside `<Suspense>`; otherwise `next build` fails or tries to query the DB at build time, which has no access to it on Render.
- Only one person at a time generates migrations (`npm run db:generate`); two parallel `0001_*` files collide in `db/migrations/meta/_journal.json`.
- On Render's free plan `olm-web` sleeps after ~15 min; the first request takes 30–60 s.
- Production storage is the private B2 bucket `olm-media-epoqpl` (CORS allows presigned PUT/GET/HEAD from any origin; hidden file versions are purged after a day). Its bucket-scoped key is set in the Render dashboard; ask the backend owner for a local copy. B2 keeps old versions on a plain S3 delete, so always delete through `storage.delete()`, which removes every version.
- CI (`.github/workflows/ci.yml`) runs each job only when the PR touches its files: `web` (lint, build), `db` (migration checks, rule tests, seed), `storage` (typecheck, key and delete tests; the MinIO round trip is local only), `mock-api` (tests) and `android` (build, lint). Editing the workflow runs them all.
- `npm install` turns on a pre-push hook (`.githooks/pre-push`) with light versions of the CI checks for the areas the push changes: eslint on changed `web` files, migration checks for `db`, the `storage` unit tests and the mock API tests. Android and the web build are left to CI. Skip it with `git push --no-verify`.
