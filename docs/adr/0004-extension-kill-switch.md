# 0004 — Graduated extension kill-switch

**Status:** Accepted (B72, 2026-05-30). Live.

## Context

The extension auto-updates on the Chrome Web Store's unpredictable schedule and
**can't be force-updated**. If a shipped version is dangerous (corrupts data,
security hole), we need a server-side way to react before CWS propagates a fix —
but a hard "stop recording" is itself harmful: a stopped recording is a
**permanently lost game** (you can't re-record a past karabast match), and the
CWS→Chrome update lag is outside the user's control, so a hard stop bricks
exactly during the window we can't fix.

## Decision

- `GET /api/extension/status?v=<v>` returns a tier from a live, env-overridable
  policy (`lib/extensionPolicy.ts`):
  - **ok** — silent, up to date.
  - **nag** — behind `latestVersion`: show "update available", keep FULLY
    working. The everyday "you're behind" signal.
  - **block** — below `minSupportedVersion`: **break-glass only.** Disable just
    the broken interaction and **keep buffering recordings locally.**
- Default posture is `ok`/`nag`. `minSupportedVersion` defaults to `0.0.0` so
  nobody is blocked until it's deliberately raised. An unidentifiable version →
  `ok` (never brick a client we can't parse).
- Env knobs: `KARABUDDY_EXT_LATEST` / `_MIN_SUPPORTED` / `_NAG_MESSAGE` /
  `_BLOCK_MESSAGE`. Keep `_LATEST` tracking the CWS-published version.
- The extension pings on load (`06-bootstrap.js`) and renders through the
  existing context-invalidated toast surface — one consistent "you need to
  update" UX, not a duplicate.

## Consequences

- Flipping the switch is a Vercel env change + redeploy, not a CWS release.
- Not instant — for a no-deploy flip we'd move the policy to a DB row / Edge
  Config later (noted in B72).
- Routine schema drift is NOT a `block` case — backward-compat + contract tests
  (see [0002](./0002-gated-deploys.md)) handle that. Reserve `block`.
