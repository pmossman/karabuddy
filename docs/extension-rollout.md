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

## Cutting an extension release (automatic)

Releases are cut automatically by the `extension-release` workflow whenever
extension code lands on `main` (`extension/**` or `lib/commentScope.js`). It
runs the extension unit tests (incl. the `commentScope` parity check), builds
`dist/karabuddy-extension-X.Y.Z.zip`, and publishes a **GitHub Release**.

It does **NOT** submit to the Chrome Web Store — that's a deliberate human
step, so tiny pushes never flood CWS review. (Users only ever get the latest
*approved* version anyway, so intermediate auto-builds cost nothing.)

Versioning is hybrid:
- **Patch** is hands-off — push extension changes and CI auto-increments the
  patch (commits the bump back to `main` via `GITHUB_TOKEN`, which doesn't
  re-trigger CI) and releases it.
- **Minor / major** — bump `version` + `version_name` in
  `extension/manifest.json` yourself in the same change; CI sees the new
  (unreleased) version and releases it as-is instead of auto-patching.

> Branch protection note: CI pushes the auto-patch bump to `main` with
> `GITHUB_TOKEN`. If `main` ever gets protected against direct pushes, give
> the workflow an exception or switch to bumping the manifest by hand.

## Submitting to the Chrome Web Store (deliberate)

Promotion to users is a manual trigger, not per-push. Two equivalent paths:

- **GitHub Action (preferred):** Actions tab → **extension-submit-cws** → Run
  workflow → pick the tag (blank = latest `ext-v*`) and whether to publish
  (submit for review) or upload a draft. It downloads that Release's zip and
  pushes it to CWS via the API. Batch meaningful changes; don't submit per build.
- **By hand:** download a Release's zip → CWS dashboard → upload → submit.
  (`npm run package:extension` builds the same zip locally.)

### Chrome Web Store API creds (one-time, for the Action)

The submit Action needs four repo secrets (Settings → Secrets and variables →
Actions). Getting them once:

1. **`CWS_EXTENSION_ID`** — the item id from the CWS developer dashboard URL.
2. **Google OAuth client** — Google Cloud Console → enable the *Chrome Web
   Store API* → create an OAuth 2.0 Client ID (type: Desktop app). That gives
   **`CWS_CLIENT_ID`** + **`CWS_CLIENT_SECRET`**.
3. **`CWS_REFRESH_TOKEN`** — a long-lived token for that client. Easiest is the
   interactive helper: `npx chrome-webstore-upload-keys` (walks the OAuth
   consent for scope `https://www.googleapis.com/auth/chromewebstore` and
   prints the refresh token). See the `chrome-webstore-upload` project docs.
4. Add all four as repo secrets. Then the Action works.

These creds can publish the extension — keep them as Actions secrets only
(repo admins), never in the repo.

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
