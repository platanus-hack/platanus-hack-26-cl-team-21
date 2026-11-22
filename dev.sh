#!/usr/bin/env bash
# Starts everything the web side needs: Postgres, MinIO (if Docker is available), migrations,
# the Next.js portal/API and the worker. Ctrl+C stops what this script started.
#
# Usage: ./dev.sh [--no-worker] [--no-seed]
set -euo pipefail

cd "$(dirname "$0")"

WORKER=1
SEED=1
for arg in "$@"; do
  case "$arg" in
    --no-worker) WORKER=0 ;;
    --no-seed) SEED=0 ;;
    -h | --help)
      sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

log() { printf '\033[1;33m[dev]\033[0m %s\n' "$*"; }

if [ ! -f .env ]; then
  cp .env.example .env
  log "Created .env from .env.example"
fi
set -a
# shellcheck disable=SC1091
. ./.env
set +a

if [ ! -d node_modules ]; then
  log "Installing dependencies"
  npm install
fi

DB_NAME="$(basename "${DATABASE_URL%%\?*}")"

# Homebrew's postgresql@N is keg-only: put its client tools (pg_isready, createdb) on PATH.
if command -v brew >/dev/null; then
  PG_FORMULA="$(brew list --formula | grep -E '^postgresql@' | head -1 || true)"
  [ -n "$PG_FORMULA" ] && PATH="$(brew --prefix "$PG_FORMULA")/bin:$PATH"
fi

# Postgres: Docker if the URL points at the compose credentials, otherwise Homebrew.
if ! pg_isready -q -d "$DATABASE_URL" 2>/dev/null; then
  if [[ "$DATABASE_URL" == *postgres:postgres@* ]] && command -v docker >/dev/null; then
    log "Starting Postgres (Docker)"
    docker compose up -d postgres
  elif command -v brew >/dev/null; then
    PG_FORMULA="$(brew list --formula | grep -E '^postgresql@' | head -1 || true)"
    if [ -z "$PG_FORMULA" ]; then
      echo "Postgres not found. Install it (brew install postgresql@17) or use Docker; see DEVELOPMENT.md." >&2
      exit 1
    fi
    log "Starting Postgres ($PG_FORMULA)"
    brew services start "$PG_FORMULA" >/dev/null
    "$(brew --prefix "$PG_FORMULA")/bin/createdb" "$DB_NAME" 2>/dev/null || true
  else
    echo "Postgres is not reachable at DATABASE_URL and neither Docker nor Homebrew is available." >&2
    exit 1
  fi
  for _ in $(seq 1 30); do
    pg_isready -q -d "$DATABASE_URL" 2>/dev/null && break
    sleep 1
  done
  pg_isready -q -d "$DATABASE_URL" || { echo "Postgres did not become ready" >&2; exit 1; }
fi

# Object storage for presigned uploads (optional for UI work).
if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  log "Starting MinIO (Docker)"
  docker compose up -d minio minio-init
else
  log "Docker not running: skipping MinIO (uploads will not work)"
fi

log "Running migrations"
npm run db:migrate
if [ "$SEED" = 1 ]; then
  log "Seeding demo study"
  npm run db:seed
fi

PIDS=()
cleanup() {
  trap - INT TERM EXIT
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

log "Web:    http://localhost:${PORT:-3000}"
npm run dev:web &
PIDS+=($!)

if [ "$WORKER" = 1 ]; then
  npm run dev:worker &
  PIDS+=($!)
fi

# Exit as soon as either process dies.
while true; do
  for pid in "${PIDS[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      exit 1
    fi
  done
  sleep 1
done
