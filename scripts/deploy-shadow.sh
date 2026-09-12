#!/usr/bin/env bash
# Deploy the free-tier SHADOW project (karabuddy-shadow) — and refuse to do
# anything else. Runs from the dedicated clone at ~/karabuddy-shadow, checks the
# Vercel link there names the shadow project, and only then deploys.
#
# Incident 2026-09-12: a `vercel deploy --prod` chained after git commands ran
# in ~/code/karabuddy (linked to PROD) and applied migrations to prod before
# its build failed. Never call `vercel deploy` outside this script.
set -euo pipefail
DIR="${SHADOW_DIR:-$HOME/karabuddy-shadow}"
cd "$DIR"
NAME=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(".vercel/project.json","utf8")).projectName)')
if [ "$NAME" != "karabuddy-shadow" ]; then echo "refusing: $DIR is linked to '$NAME', not karabuddy-shadow" >&2; exit 1; fi
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "free-tier-migration" ]; then echo "refusing: $DIR is on '$BRANCH', not free-tier-migration" >&2; exit 1; fi
git pull -q origin free-tier-migration
echo "deploying $(git rev-parse --short HEAD) to karabuddy-shadow from $DIR"
exec vercel deploy --prod --yes "$@"
