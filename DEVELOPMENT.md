# Development

| Folder | What | Stack |
|---|---|---|
| `web/` | Researcher portal + API (`/api/*`) | Next.js, TypeScript |
| `worker/` | Background processing (video, AI) that consumes the `jobs` table | Node, TypeScript (tsx) |
| `db/` | Schema and migrations shared by `web` and `worker` | Drizzle ORM, Postgres |
| `android/` | Participant app | Kotlin, Jetpack Compose |
| `render.yaml` | Render Blueprint: `olm-web`, `olm-worker`, `olm-db` | Render |

## Web + worker locally

Local Postgres with Homebrew (once):

```bash
brew install postgresql@17 && brew services start postgresql@17
"$(brew --prefix postgresql@17)/bin/createdb" observatorio
```

Prefer Docker? `docker compose up -d` and use the alternative URL in `.env.example`.

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run dev:web               # http://localhost:3000/api/health
npm run dev:worker
curl -X POST localhost:3000/api/jobs   # the worker prints "hello from worker"
```

Changing the schema: edit the module for that area in `db/src/schema/`, then `npm run db:generate` and commit the migration in `db/migrations/`. Rules Drizzle can't express (no-overlap constraints, triggers, SQL functions) go in a custom migration; see [`db/README.md`](db/README.md). `npm run db:test` checks those rules against your database (rolled back).

## Android

Open `android/` in Android Studio and run it on the emulator; by default it calls `http://10.0.2.2:3000` (the host's `npm run dev:web`). For another backend: `./gradlew installDebug -PapiBaseUrl=https://...`.

No backend yet? `npm run mock:api` serves the enrollment and upload API v0 on port 4010; see [`tools/mock-api/README.md`](tools/mock-api/README.md).

## Deploy

Render only deploys from repos you own: set up the personal mirror described in `AGENTS.md` (Deploy notes) and create a Blueprint pointing at `render.yaml`. Migrations run when `olm-web` starts.

## Notes

- `web/` uses Cache Components (Next 16): a page or route handler that reads the DB must call `await connection()` (from `next/server`) or be inside `<Suspense>`; otherwise `next build` fails or tries to query the DB at build time, which has no access to it on Render.
- Only one person at a time generates migrations (`npm run db:generate`); two parallel `0001_*` files collide in `db/migrations/meta/_journal.json`.
- On Render's free plan `olm-web` sleeps after ~15 min; the first request takes 30–60 s.
