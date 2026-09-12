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
# The shadow may run either the expand branch (PR #28) or the contract branch
# (PR #29) — never main. Pass SHADOW_BRANCH to switch.
WANT="${SHADOW_BRANCH:-free-tier-migration}"
case "$WANT" in free-tier-migration|b235-contract-drop-card-events) ;; *) echo "refusing: '$WANT' is not a shadow branch" >&2; exit 1;; esac
git fetch -q origin "$WANT" && git checkout -q "$WANT" && git pull -q origin "$WANT"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "$WANT" ]; then echo "refusing: $DIR is on '$BRANCH', not $WANT" >&2; exit 1; fi
echo "deploying $(git rev-parse --short HEAD) to karabuddy-shadow from $DIR"
exec vercel deploy --prod --yes "$@"
