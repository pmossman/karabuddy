# Extension rollout runbook

How to ship server + extension changes without breaking users while a new
extension version waits for (unpredictable) Chrome Web Store review.

## The invariant

The extension auto-updates on CWS's schedule and **can't be force-updated**,
so at every instant the live server must serve **every extension version in
the wild** (old *and* new). Therefore:

> **Server changes are additive w.r.t. the published extension** — new
> optional fields / new endpoints; never remove or repurpose what a shipped
> extension sends — **and the server deploys BEFORE the new extension
> publishes.**

The `test/e2e/contract-extension-0.5.0.spec.ts` contract tests enforce the
"additive" half: they replay the shipped version's exact request shapes
against the current server. If a change breaks them, it isn't backward
compatible — make it additive instead.

## Safe sequence

1. **Develop** server + extension changes together on a branch.
2. **Preview-test the new combo.** Push the branch → Vercel preview deploy.
   Point a dev-unpacked extension at it:
   `chrome.storage.local.set({ karabuddyEndpoint: '<preview-url>' })`, then
   reload a karabast.net tab. Verify new-ext ↔ new-server.
3. **CI compat gate.** CI runs the contract tests (old-ext ↔ new-server) +
   the migration-journal guard + the full suite. Green before merge.
4. **Deploy the server first.** Merge to `main` → Vercel builds; the
   `prebuild` (`scripts/maybe-migrate.js`) validates the migration journal
   then applies pending migrations. Prod now speaks BOTH protocols.
5. **Then publish the extension.** Tag `ext-vX.Y.Z` (see below) → upload the
   zip to the CWS dashboard → submit for review. The review window is now
   safe: prod already supports the new ext and still supports the old one.
6. **CWS approves** → users auto-update → nothing breaks.

## Cutting an extension release

1. Bump `version` + `version_name` in `extension/manifest.json`.
2. Tag it: `git tag ext-vX.Y.Z && git push --tags`. The
   `extension-release` workflow validates the manifest version matches the
   tag, runs the extension unit tests (incl. the `commentScope` parity
   check), syncs shared files, builds `dist/karabuddy-extension-X.Y.Z.zip`,
   and attaches it to a GitHub Release.
3. Download that zip → CWS dashboard → submit. (`package:extension` runs the
   same build locally if you'd rather not wait for CI.)

## Adding a new contract baseline

When you ship a version whose request shapes changed, freeze the NEW
shapes as `test/e2e/fixtures/contract-<version>.ts` + a spec, and keep the
old one until that old version is provably gone from the wild. The point is
to keep replaying every still-live version against the current server.

## Migrations

- Local dev must run `npm run db:migrate` to apply pending migrations (prod
  auto-applies via `maybe-migrate`; tests use pglite). **Note:** local
  currently points at the prod DB — see B74.
- Keep journal `when` timestamps strictly increasing; a non-monotonic entry
  is silently skipped by drizzle's migrator. The journal guard
  (`scripts/validate-migration-journal.js`, run in CI + the prod build)
  fails loudly if this is violated.

## Emergency kill-switch (planned, B72)

`GET /api/extension/status` → `ok | nag | block`. Default `ok`/`nag`
(update banner, keeps working). Reserve `block` for a genuinely dangerous
version, disable only the broken interaction, and keep buffering recordings
locally — a stopped recording is a permanently lost game. Renders through
the existing context-invalidated toast.

## Auth-gated setup (one-time, needs the Vercel/Neon dashboard) — B72/B74

- **Preview DB isolation:** enable the Neon–Vercel integration so each
  preview deploy gets an isolated DB branch (today previews share prod).
- **Staging:** a `staging` branch → `staging.karabuddy.app` + its own Neon
  branch for a durable pre-CWS validation target.
- **Local DB:** point `.env.local` at a separate DB, not prod — see
  [docs/local-dev-db.md](./local-dev-db.md) (Neon-branch click-path +
  `npm run db:pull-snapshot`). B74.
- **CWS auto-submit (optional):** store Chrome Web Store API creds as repo
  secrets to let the release workflow submit, not just build.
