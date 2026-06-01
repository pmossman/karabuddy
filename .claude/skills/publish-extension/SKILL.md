---
name: publish-extension
description: >-
  Prepare and submit a new Chrome Web Store publication of the KaraBuddy
  browser extension. Validates the packaged zip, listing assets, and per-
  permission justifications against the packaged manifest, emits a paste-ready
  submission pack, and fires the deliberate CWS package submit. Use when the
  user wants to publish / release / submit the extension to the Chrome Web
  Store, prep a CWS listing, or cut a new extension store version.
---

# Publish the KaraBuddy extension to the Chrome Web Store

Take the latest extension build to a Chrome Web Store submission with everything
validated, so the human's only manual step is pasting listing fields + uploading
images + clicking **Submit** in the CWS dashboard.

## What is and isn't automatable (read first)

- The **Chrome Web Store API handles the code package only** — upload zip,
  publish, status. **Listing metadata has no API**: description, screenshots,
  promo tiles, category, privacy-practice checkboxes, and permission
  justifications are dashboard-only. Do **not** browser-automate the dashboard
  Submit — this skill is paste-pack only.
- `extension-release.yml` already auto-cuts a versioned GitHub Release zip on
  every extension push to `main`. `extension-submit-cws.yml` (workflow_dispatch)
  uploads a release zip to CWS via `chrome-webstore-upload-cli`. Submission is
  deliberate/batched, not per-push.
- Canonical references: `docs/extension-rollout.md` (rollout invariant + CWS API
  cred setup) and `docs/chrome-web-store-listing.md` (paste-ready listing copy).

## Procedure

### 1. Confirm the rollout invariant
The **server must already support the version being published** (server deploys
*before* the extension — see `docs/extension-rollout.md`). Confirm `main` is
deployed and the extension contract tests are green
(`test/e2e/contract-extension-*.spec.ts`). If a server change this version
depends on hasn't shipped to prod yet, stop — publishing now would break users
during CWS review.

### 2. Resolve the target version
- `node -p "require('./extension/manifest.json').version"`
- `gh release list --limit 10` → confirm the matching `ext-v<version>` Release
  exists (the submit workflow pulls the zip from there). If you intend a
  minor/major, make sure the manifest version was bumped (CI auto-patches
  otherwise — see the rollout runbook's versioning section).

### 3. Regenerate assets only if branding changed
- Skip unless icons/logo changed. To regenerate: `bash scripts/generate-icons.sh`
  (needs Google Chrome at the macOS path; writes icons + `store-icon-128.png` +
  promo tiles from the committed 2056² master).
- Screenshots are captured by hand via agent-browser at **1280×800** against the
  live app — there is no generator. Flag to the user if they look stale relative
  to recent UI changes (e.g. the mobile viewer redesign).

### 4. Build + validate (must pass before submitting)
```sh
npm run package:extension                                  # dist zip (strips dev hosts)
node .claude/skills/publish-extension/validate-release.mjs # blocks on any ✗
```
The validator checks: zip exists + version consistent; **every packaged
permission/host has a justification** in the listing doc (reviewer red-flag
otherwise); short description ≤132 chars; store icon 128², screenshots
1280×800/640×400; no stale script references. Fix every `✗` before continuing;
review `⚠` (optional promo tiles, screenshot count). Also run `npm run test:unit`
if not already green this session (extension `commentScope` parity).

### 5. Emit the submission pack
Read `docs/chrome-web-store-listing.md` and present it back **ready to paste**,
field by field, in dashboard order: Name, Short description (with char count),
Category, Detailed description, Single-purpose statement, each Permission
justification, the Privacy-practice checkbox selections, and Privacy/Homepage/
Support URLs. Then list the **asset files to upload** in order
(`assets/store/store-icon-128.png`, `screenshot-1..5`, any promo tiles) and a
tight dashboard checklist. If the user knows what changed since the last submit,
narrow the checklist to just those fields.

### 6. Submit the package (deliberate — CONFIRM first)
Submitting publishes to real users, so confirm with the user before firing.
```sh
gh workflow run extension-submit-cws.yml -f tag=ext-v<version> -f publish=true
# publish=false uploads a draft only (no review submission)
gh run list --workflow=extension-submit-cws.yml --limit 1   # then `gh run watch <id>`
```
Needs the four `CWS_*` repo secrets (`docs/extension-rollout.md` → "Chrome Web
Store API creds"). If the run fails on missing secrets, surface that and point
the user at the setup walkthrough (one-time; only the user can do it). Reminder:
the OAuth consent screen must be **In production**, not Testing, or the refresh
token expires in 7 days.

### 7. After CWS approves
Bump `KARABUDDY_EXT_LATEST` (Vercel env) to the published version so the
kill-switch "update available" nag tracks reality (`lib/extensionPolicy.ts`
default is currently stale at `0.5.1`).

## Guardrails
- Paste-pack only — never drive the dashboard Submit via browser automation.
- Submitting is outward-facing: confirm before `gh workflow run`. Batch
  meaningful changes; don't submit per patch build.
- Validate against the **packaged** manifest (dev hosts stripped), never the
  source `extension/manifest.json`.
