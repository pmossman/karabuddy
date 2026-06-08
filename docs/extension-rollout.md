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
2. **Test the new combo locally.** Run local dev (Docker DB, see
   [local-dev-db.md](./local-dev-db.md)) and point a dev-unpacked extension at
   it: `chrome.storage.local.set({ karabuddyEndpoint: 'http://localhost:3001' })`,
   reload a karabast.net tab, verify new-ext ↔ new-server. (Vercel preview
   deploys aren't used for this — they're SSO-protected and the bypass is
   Pro-only; the gated pipeline does the deployed-build verification instead.)
3. **CI compat gate.** Open a PR → `test.yml` runs the contract tests
   (old-ext ↔ new-server) + the migration-journal guard + the full suite.
   Green before merge.
4. **Deploy the server first (gated).** Merge to `main` → `deploy.yml` re-runs
   the suite, migrates the isolated `ci-preview` Neon branch, builds the real
   prod bundle and smokes it against `ci-preview`, then `vercel deploy --prod`.
   The prod build's `prebuild` (`scripts/maybe-migrate.js`) validates the
   journal then applies pending migrations to prod. Vercel's own main
   auto-deploy is off (`vercel.json`). Prod now speaks BOTH protocols.
5. **Then publish the extension.** The push auto-cuts a GitHub Release
   (`extension-release.yml`); promote it to users via the manual
   `extension-submit-cws` workflow (see below). The review window is now
   safe: prod already supports the new ext and still supports the old one.
6. **CWS approves** → users auto-update → nothing breaks.

## Cutting an extension release (automatic)

Releases are cut automatically by the `extension-release` workflow whenever
extension code lands on `main` (`extension/**`, `lib/commentScope.js`, or
`scripts/package-extension.sh`). It
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

## Submitting to Firefox / AMO (deliberate)

The extension also ships on Firefox (Gecko). Each auto-cut Release carries a
**second** zip — `karabuddy-extension-firefox-X.Y.Z.zip` — built by
`npm run package:extension:firefox` (a Gecko manifest variant: event-page
`background.scripts` instead of a service worker, no `type:module`, Chrome-only
`version_name` stripped, plus `browser_specific_settings.gecko` with the add-on
id, `strict_min_version` 140 / Android 142, and the `data_collection_permissions`
disclosure). `world: "MAIN"` is kept — Firefox supports it (128+); the 140 floor
is for `data_collection_permissions`. Build it cleanly: `npx web-ext lint` reports
0 errors / 0 warnings.

Promotion is a manual trigger (same model as CWS):

- **GitHub Action (preferred):** Actions tab → **extension-submit-amo** → Run
  workflow → pick the tag (blank = latest `ext-v*`) and the channel (`listed` =
  public AMO review; `unlisted` = AMO-signed `.xpi` for self-hosting, attached
  as a workflow artifact). It downloads the Release's firefox zip and submits via
  `web-ext sign`.
- **By hand:** download a Release's firefox zip → addons.mozilla.org Developer
  Hub → upload a new version. (`npm run package:extension:firefox` builds the
  same zip locally; the unpacked dir under `dist/` loads via `about:debugging`
  → Load Temporary Add-on for local testing.)

### Firefox / AMO API creds + first listing (one-time)

The Action needs two repo secrets (Settings → Secrets and variables → Actions):

1. A Mozilla **add-on developer account** (addons.mozilla.org). The add-on id is
   fixed as `karabuddy@karabuddy.app` (in the Gecko manifest).
2. **First listed submission is via the AMO web UI** — upload the firefox zip,
   then complete the listing (summary/description, screenshots, categories,
   **privacy policy**, and the **data-collection** disclosure — we declare
   `websiteContent`, since we upload karabast game state). AMO reviews it; once
   the add-on exists, the Action ships subsequent versions.
3. **API key** — Developer Hub → **Manage API Keys** → generate. That yields
   the **`AMO_JWT_ISSUER`** (key) + **`AMO_JWT_SECRET`** (secret). Add both as
   repo secrets. The secret is shown once — copy it immediately.

These creds can publish the extension — Actions secrets only, never in the repo.

## Adding a new contract baseline

When you ship a version whose request shapes changed, freeze the NEW
shapes as `test/e2e/fixtures/contract-<version>.ts` + a spec, and keep the
old one until that old version is provably gone from the wild. The point is
to keep replaying every still-live version against the current server.

## Migrations

- Local dev applies migrations with `npm run db:migrate` against the local
  Docker DB (B74); prod auto-applies via `maybe-migrate` on the gated build;
  CI/tests use pglite or the `ci-preview` branch. Confirm `db:migrate` reports
  `localhost:5434` before running it — `.env.local` is prod.
- Keep journal `when` timestamps strictly increasing; a non-monotonic entry
  is silently skipped by drizzle's migrator. The journal guard
  (`scripts/validate-migration-journal.js`, run in CI + the prod build)
  fails loudly if this is violated.

## Graduated kill-switch (live, B72)

`GET /api/extension/status?v=<v>` → `{ status, minSupportedVersion,
latestVersion, message, capabilities }` (`lib/extensionPolicy.ts`,
env-overridable via `KARABUDDY_EXT_LATEST` / `_MIN_SUPPORTED` /
`_NAG_MESSAGE` / `_BLOCK_MESSAGE`). The extension pings it on load
(`06-bootstrap.js`) and renders through the existing toast surface. Tiers:
`ok` (silent) / `nag` (update-available banner, keeps working — the everyday
"you're behind" signal) / `block` (break-glass only; even then, disable just
the broken interaction and keep buffering recordings locally — a stopped
recording is a permanently lost game). Default posture is `ok`/`nag`; raise
`KARABUDDY_EXT_MIN_SUPPORTED` only to break-glass. Keep `KARABUDDY_EXT_LATEST`
tracking the CWS-published version.

## Remaining auth-gated setup (optional, needs the Vercel/CWS dashboard)

- **CWS auto-submit:** store the four `CWS_*` API creds as repo secrets to let
  the `extension-submit-cws` workflow submit (today it needs them; without
  them, submit by hand). See the creds section above.
- **AMO auto-submit:** create the AMO add-on + its first listed version via the
  web UI, then store `AMO_JWT_ISSUER` + `AMO_JWT_SECRET` as repo secrets for the
  `extension-submit-amo` workflow. See "Firefox / AMO" above.

Dropped from the original plan: per-preview Vercel DB branching (we don't gate
on Vercel previews — the gated pipeline smokes against the `ci-preview` branch
instead, and a Pro plan would be needed for SSO-bypassed previews) and a
separate `staging` env (obviated by the gated pipeline). Local DB isolation is
done via Docker, not a Neon branch — see [local-dev-db.md](./local-dev-db.md).
