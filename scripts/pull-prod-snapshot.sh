#!/usr/bin/env bash
# B74: refresh the local DEV Postgres (docker-compose.dev.yml) from a
# production snapshot. Runs pg_dump | pg_restore INSIDE the dev-db container
# (postgres:16 ships the client tools), so no host Postgres install is needed:
#   • pg_dump reaches prod over the internet (read-only).
#   • pg_restore targets the container's own localhost:5432 — so the target
#     is ALWAYS the local dev DB and can never be prod.
#
# Source = prod, taken from .env.local (the Vercel-pulled POSTGRES_URL_NON_
# POOLING, or SNAPSHOT_SOURCE_URL if you set one). NOTE: the script reads
# .env.local — NOT .env.development.local — so the local override never
# becomes the dump source. Destructive on the local dev DB only.
#
# Run:  npm run db:pull-snapshot           (prompts first)
#       npm run db:pull-snapshot -- --yes  (skip the prompt)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Prod source comes from .env.local only.
if [[ -f .env.local ]]; then set -a; source .env.local; set +a; fi
SRC="${SNAPSHOT_SOURCE_URL:-${POSTGRES_URL_NON_POOLING:-}}"
if [[ -z "$SRC" ]]; then
  echo "error: no prod source — set SNAPSHOT_SOURCE_URL or POSTGRES_URL_NON_POOLING in .env.local" >&2
  exit 1
fi
case "$SRC" in
  *localhost*|*127.0.0.1*|*dev-db*)
    echo "error: snapshot SOURCE looks local — it must be the remote prod DB. Refusing." >&2
    exit 1 ;;
esac

COMPOSE=(docker compose -f docker-compose.dev.yml)
strip() { sed -E 's#://[^@]+@#://***@#'; }
echo "SOURCE (prod, dumped read-only): $(printf '%s' "$SRC" | strip)"
echo "TARGET (local dev-db container, DROP + restore): postgres://karabuddy_dev:***@localhost:5432/karabuddy_dev"

if [[ "${1:-}" != "--yes" ]]; then
  read -r -p "This DROPS and replaces everything in the LOCAL dev DB. Continue? [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]] || { echo "aborted."; exit 1; }
fi

echo "→ ensuring dev-db is up…"
"${COMPOSE[@]}" up -d --wait

echo "→ dump prod | restore into local dev-db (inside the container)…"
"${COMPOSE[@]}" exec -T -e SRC="$SRC" dev-db \
  sh -c 'pg_dump --format=custom --no-owner --no-privileges --no-acl "$SRC" \
    | pg_restore --no-owner --no-privileges --no-acl --clean --if-exists \
        -d "postgres://karabuddy_dev:karabuddy_dev@localhost:5432/karabuddy_dev"'

echo "✓ local dev DB refreshed from prod. Replay payloads still load from prod Blob URLs."
