# Desarrollo

| Carpeta | Qué es | Stack |
|---|---|---|
| `web/` | Portal de investigadores + API (`/api/*`) | Next.js, TypeScript |
| `worker/` | Procesamiento en segundo plano (video, IA) que consume la tabla `jobs` | Node, TypeScript (tsx) |
| `db/` | Esquema y migraciones compartidos por `web` y `worker` | Drizzle ORM, Postgres |
| `android/` | App del participante | Kotlin, Jetpack Compose |
| `render.yaml` | Blueprint de Render: `olm-web`, `olm-worker`, `olm-db` | Render |

## Web + worker en local

Postgres local con Homebrew (una vez):

```bash
brew install postgresql@17 && brew services start postgresql@17
"$(brew --prefix postgresql@17)/bin/createdb" observatorio
```

¿Prefieres Docker? `docker compose up -d` y usa la URL alternativa de `.env.example`.

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run dev:web               # http://localhost:3000/api/health
npm run dev:worker
curl -X POST localhost:3000/api/jobs   # el worker imprime "hello from worker"
```

Cambiar el esquema: editar `db/src/schema.ts`, luego `npm run db:generate` y commitear la migración en `db/migrations/`.

## Android

Abrir `android/` en Android Studio y ejecutar en el emulador; por defecto llama a `http://10.0.2.2:3000` (el `npm run dev:web` del host). Para otro backend: `./gradlew installDebug -PapiBaseUrl=https://...`.

## Deploy

Render solo despliega desde repos propios: configurar el mirror descrito en el README y crear un Blueprint apuntando a `render.yaml`. Las migraciones corren al iniciar `olm-web`.

## Notas

- `web/` usa Cache Components (Next 16): una página o route handler que lea la DB debe llamar `await connection()` (de `next/server`) o estar dentro de `<Suspense>`; si no, `next build` falla o intenta consultar la DB en el build, que en Render no tiene acceso a ella.
- Una sola persona a la vez genera migraciones (`npm run db:generate`); dos `0001_*` en paralelo chocan en `db/migrations/meta/_journal.json`.
- En el plan gratis de Render `olm-web` se duerme tras ~15 min; la primera petición tarda 30–60 s.
