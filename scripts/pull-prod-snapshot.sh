#!/usr/bin/env bash
# B74: refresh a LOCAL dev database from a production snapshot, so local dev
# has realistic data without pointing at prod.
#
#   SNAPSHOT_SOURCE_URL  prod connection string (DUMPED read-only)
#   SNAPSHOT_TARGET_URL  local/dev connection string (DROPPED + restored)
#
# Both are REQUIRED and must differ — there is no default, on purpose, so a
# misconfigured POSTGRES_URL can't silently make prod both source and target.
# Destructive on the TARGET only (pg_restore --clean --if-exists), never on
# the source. Run: `npm run db:pull-snapshot` (add --yes to skip the prompt).
#
# Requires Postgres client tools (pg_dump / pg_restore) matching the server
# major version (Neon is PG16). Blob payloads are NOT copied — replays keep
# their prod Vercel Blob URLs, which are readable from local.
set -euo pipefail

: "${SNAPSHOT_SOURCE_URL:?set SNAPSHOT_SOURCE_URL to the prod connection string}"
: "${SNAPSHOT_TARGET_URL:?set SNAPSHOT_TARGET_URL to the LOCAL/dev connection string}"

if [[ "$SNAPSHOT_SOURCE_URL" == "$SNAPSHOT_TARGET_URL" ]]; then
  echo "error: SOURCE and TARGET are identical — refusing to restore prod onto itself." >&2
  exit 1
fi

# Show hosts (creds stripped) so the operator can sanity-check direction.
strip() { sed -E 's#://[^@]+@#://***@#'; }
echo "SOURCE (dump, read-only): $(printf '%s' "$SNAPSHOT_SOURCE_URL" | strip)"
echo "TARGET (DROP + restore):  $(printf '%s' "$SNAPSHOT_TARGET_URL" | strip)"

if [[ "${1:-}" != "--yes" ]]; then
  read -r -p "This DROPS and replaces everything in TARGET. Continue? [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]] || { echo "aborted."; exit 1; }
fi

DUMP="$(mktemp -t kb-prod-snapshot-XXXXXX).dump"
trap 'rm -f "$DUMP"' EXIT

echo "→ dumping source…"
pg_dump --format=custom --no-owner --no-privileges --no-acl -f "$DUMP" "$SNAPSHOT_SOURCE_URL"

echo "→ restoring into target (clean)…"
pg_restore --no-owner --no-privileges --clean --if-exists --no-acl -d "$SNAPSHOT_TARGET_URL" "$DUMP"

echo "✓ local DB refreshed from prod snapshot. Replay payloads still load from prod Blob URLs."
