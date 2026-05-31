# 0002 — Gated production deploys (no push-to-deploy)

**Status:** Accepted (B72, 2026-05-30). Live.

## Context

Vercel's default is to deploy `main` to production on every push. With an
unforce-updatable extension in the wild, an untested server change (or a
silently-skipped migration) reaching prod can break every live extension
version at once. We needed a green-suite gate in front of prod, and a way to
verify the **real prod build against an isolated DB** before it goes live —
without paying for Vercel Pro (SSO-protected previews + bypass are Pro-only).

## Decision

- Turn off Vercel's main auto-deploy (`vercel.json` →
  `git.deploymentEnabled.main=false`).
- Ship prod only through `deploy.yml` on push to `main`:
  1. **test** — typecheck + unit + api + e2e (Postgres service container).
  2. **smoke-and-deploy** — migrate the isolated `ci-preview` Neon branch →
     `next build` the real prod bundle → smoke it locally (`next start`,
     `playwright.smoke.config.ts`) against `ci-preview` → on green,
     `vercel deploy --prod`.
- The prod build's `prebuild` (`scripts/maybe-migrate.js`) validates the
  migration journal then applies pending migrations **to prod only** (skipped
  for previews/local/CI).
- `paths-ignore` skips the cycle when every changed file is docs or
  extension-only. `lib/commentScope.js` is deliberately not ignored (web
  imports it).

## Consequences

- Slower path to prod (full suite + smoke), accepted for safety.
- Requires repo secrets `VERCEL_TOKEN` + `CI_PREVIEW_POSTGRES_URL`.
- Per-preview Vercel DB branching and a separate `staging` env were dropped —
  the `ci-preview` smoke covers the same need without Pro.
- CI-local smoke (not a deployed preview) verifies the real build + real
  isolated DB end to end; revisit if we ever move to Pro.
