# karabuddy

Hosted companion to karabast.net for Star Wars Unlimited: replay capture, mid-game tagging, a frame-by-frame viewer, teams, and shared review. Live at **karabuddy.app**.

Two cooperating pieces:

- **Webapp** (repo root) — Next.js 16 App Router. Owns the viewer (`/r/[slug]`), replay browser (`/replays`), teams, mentions, accounts, and all APIs.
- **Chrome MV3 extension** (`extension/`, in-tree, buildless plain JS) — the only thing that can run on karabast.net itself. Intercepts the game WebSocket, records matches, lets you tag moments mid-game, and uploads payloads to the webapp. Also runs a small bridge content script on karabuddy origins for the account-claim flow.

> See [CONTEXT.md](./CONTEXT.md) for the domain glossary (replay, tag, team, scope, share, armed, install token, surfacing, frame, leader/base) and [docs/adr/](./docs/adr/) for the key design decisions.

## Stack

- Next.js 16 App Router (TypeScript), MUI
- Neon Postgres + Drizzle ORM
- Vercel Blob (replay payload storage)
- Auth.js v5 (`next-auth` beta) — Discord + Google OAuth, Drizzle adapter
- Chrome MV3 plain-JS extension (no build step)
- Deployed on Vercel

## Architecture map

- `app/(app)/` — pages: `page.tsx` (home, teams-centric per B70), `r/[slug]` (viewer) + `r/[slug]/deck/[playerId]` (deck page), `replays`, `teams` + `teams/[slug]` + `teams/join`, `mentions`, `settings`, `signin`, `claim`, `install`, `privacy`.
- `app/api/` — route handlers. Notable: `replays/` (upload + upsert), `replays/[slug]/tags` (incl. **GET** for the scoped client-fetch), `replays/[slug]/team-shares`, `teams/...`, `me/...` (whoami, claim, extensions, mentions, teams-mention-data), `extension/status` (kill-switch), `auth/[...nextauth]`, and `test/sign-in` + `test/blob` (test-only).
- `lib/` — backend + shared logic:
  - `db.ts` — driver-agnostic Drizzle handle (`KARABUDDY_DB_DRIVER`: `neon` default / `pg` / `pglite`).
  - `schema.ts` — all tables (see CONTEXT.md).
  - `replayDecoder.ts` — decode payloads, extract winners / seen cards / decks / match meta.
  - `tagScope.ts` — server-side comment-scoping (resolve / visible / load / backfill). **The security boundary.**
  - `commentScope.js` (+ `.d.ts`) — the SHARED mentions→scope rule. Web imports it; the extension uses a byte-identical copy at `extension/replays/00-comment-scope.js`. UX convenience, re-clamped server-side.
  - `teamSurface.ts` — which replays surface to a team. `extensionPolicy.ts` — kill-switch tiers. `installToken.ts`, `mentions.ts`, `players.ts`, `replayPermissions.ts`, `slug.ts`, `userResolution.ts`, `blob.ts`, `cors.ts`.
- `extension/` — MV3 extension. `manifest.json`, `background.js` (service worker), `content.js` + `karabuddy-bridge.js` (bridge), `replays/00..07-*.js` (MAIN-world content scripts: `00-comment-scope` → `01-namespace` → `02-decoder` → `03-recorder` → `05-footer` → `06-bootstrap` → `07-toast`). Excluded from the Vercel build.
- `drizzle/` — generated migrations + `meta/_journal.json`.
- `scripts/` — `maybe-migrate.js` (prod-build prebuild), `validate-migration-journal.js`, `pull-prod-snapshot.sh`, `package-extension.sh`, backfills.
- `test/` — `unit/`, `api/`, `e2e/` (+ `fixtures/`), `smoke/`.
- `.github/workflows/` — `test.yml` (PR), `deploy.yml` (gated prod deploy), `extension-release.yml`, `extension-submit-cws.yml` (Chrome), `extension-submit-amo.yml` (Firefox).

## Auth

Auth.js v5 (`auth.ts`) with **Discord + Google** providers and the Drizzle adapter. Users have accounts, sessions, and can form **teams** (owner/member) with invite codes. The `session()` callback exposes `karabastUsername` for tag attribution.

Anonymous use still works: every extension install mints an opaque `installToken` (`kbx_<uuid>`), and uploads/tags are attributed to it. Signing in **claims** those installs (`extension_tokens` rows link token → user), so an anonymous capture history merges into the account. Most `/api/me/*` endpoints accept either a session cookie **or** an `X-Install-Token` header.

## Local development

**Do not run local dev against prod.** `.env.local` is populated by `vercel env pull` and carries the **production** Neon connection — it's the snapshot *source*, not the dev DB. Local runs against a **Docker Postgres** instead (B74).

```sh
npm install
vercel env pull .env.local        # prod creds — used as the snapshot SOURCE only
# create .env.development.local (gitignored, higher precedence than .env.local):
#   KARABUDDY_DB_DRIVER=pg
#   POSTGRES_URL=postgres://...localhost:5434/...
#   POSTGRES_URL_NON_POOLING=postgres://...localhost:5434/...
npm run db:dev:up                 # Docker Postgres on :5434 (postgres:17, matches prod PG17)
npm run db:pull-snapshot          # pg_dump prod → restore into the local container (read-only on prod)
npm run dev                       # http://localhost:3001, now on the local DB
```

Env precedence: `.env.development.local` > `.env.local` (Next.js + `drizzle.config.ts` both load the former first), so the local DB override wins and `vercel env pull` never clobbers it. Full details in [docs/local-dev-db.md](./docs/local-dev-db.md). Blob payloads aren't copied — `payloadBlobUrl` keeps pointing at prod Blob and loads read-only.

Point the extension at local: in DevTools on a karabast.net tab, `chrome.storage.local.set({ karabuddyEndpoint: 'http://localhost:3001' })`, then load `extension/` unpacked (`chrome://extensions` → Developer mode → Load unpacked) and reload after edits — **no build step**. (Dev runs on **:3001**, deliberately off **:3000** — the `karabuddy-bridge` content script only matches `localhost:3000`, so a dev profile on :3001 can't auto-pin the endpoint and hijack your real games' uploads to local. The flip side: no bridge on :3001 means no auto-claim there, so link install tokens explicitly for local recording tests.)

## Testing

Four layers (`package.json` scripts are authoritative):

```sh
npm run test:unit     # Vitest, pure logic — no infra. Seconds.
npm run test:api      # Vitest route handlers. DEFAULT driver is pglite (in-memory) — no Docker needed.
npm run test:e2e      # builds with pglite + in-memory Blob, then Playwright drives a real browser. ~30s.
npm test              # unit + api + e2e
```

- `test:api` runs on **pglite** by default (zero-install in-process Postgres). For a real-Postgres run use `npm run test:db:up` (Docker on :5433) + `npm run test:api:pg`.
- `test:e2e` builds into `.next-test` with `KARABUDDY_DB_DRIVER=pglite` + `KARABUDDY_BLOB_MODE=memory`; sign-in via `/api/test/sign-in`.
- **Smoke** (`test/smoke/`, `playwright.smoke.config.ts`) runs against a real **prod build**, not the test server — CI-only in practice (it's the deploy gate). It boots `next start` against the isolated `ci-preview` Neon branch; you generally don't run it locally.
- Contract tests, **both directions**:
  - **Backward** (`test/e2e/contract-extension-0.5.0.spec.ts`): replays the shipped 0.5.0 frozen wire shape against the current server — fails if a server change breaks an already-published extension.
  - **Forward** (`extension/replays/recorder.test.js` → "forward contract"): drives the REAL recorder, then feeds its payload to the REAL server decoder (`decodeReplay`/`extractWinners`) and asserts it still extracts frames/POV/match/winner/tags — fails if a recorder wire change drifts from what the server understands, **before** the extension is ever submitted to CWS.
- **Testing the buildless extension (B79):** the MAIN-world content scripts (`extension/replays/*.js`) are plain IIFEs that attach to `window.__KaraBuddy`. To unit-test one, add a `// @vitest-environment jsdom` test under `extension/**/*.test.js`, `eval` the file into the jsdom window, then read `window.__KaraBuddy.replays.<X>` — see `bridge.test.js`, `share-store.test.js`, `decoder.test.js`. The SW bridge contract: `companionRequest` resolves to the SW reply's `.data`, so consumers read fields directly (a `.data` re-unwrap is the B77 bug — guarded by those tests). Note `03-recorder.js` installs a `window.WebSocket` proxy at load, so it can't be eval'd under jsdom as-is.

CI: `test.yml` runs the full suite on **PRs** (Postgres service container). Pushes to `main` are gated by `deploy.yml` (same suite), so `main` isn't double-tested.

## Deploy pipeline (gated — NOT auto-deploy)

Vercel's own main auto-deploy is **off** (`vercel.json` → `git.deploymentEnabled.main=false`). Production ships only through `deploy.yml` on push to `main`:

1. **test** — `typecheck` + unit + api + e2e (Postgres service container).
2. **smoke-and-deploy** — migrate the isolated `ci-preview` Neon branch → `next build` the real prod bundle → smoke it locally (`next start`) against `ci-preview` → on green, `vercel deploy --prod`.

The prod build's `prebuild` (`scripts/maybe-migrate.js`) validates the journal then applies pending migrations **against prod only** (skipped for previews/local/CI). Requires repo secrets `VERCEL_TOKEN` + `CI_PREVIEW_POSTGRES_URL`.

`paths-ignore` skips the whole cycle when **every** changed file is docs (`**.md`, `docs/**`) or extension-only (`extension/**`, the two extension workflows) — so doc/extension commits don't trigger a prod deploy. `lib/commentScope.js` is deliberately NOT ignored (the web app imports it).

## Extension build + release

- `npm run package:extension` → `sync:extension-shared` (copies the shared dual-mode JS rules `lib/commentScope.js` → `extension/replays/00-comment-scope.js` and `lib/karabastShape.js` → `extension/replays/00-karabast-shape.js`; both parity-tested) then `scripts/package-extension.sh` → `dist/karabuddy-extension-<version>.zip` (manifest at zip root; dev hosts + source assets + `*.test.js` stripped for the published build).
- **Firefox build:** `npm run package:extension:firefox` (`package-extension.sh --firefox`) → `dist/karabuddy-extension-firefox-<version>.zip` + an unpacked dir (for `about:debugging`). Gecko manifest variant: event-page `background.scripts` (no service worker / `type:module`), `version_name` stripped, `browser_specific_settings.gecko` (id `karabuddy@karabuddy.app`, `strict_min_version` 140 / Android 142, `data_collection_permissions: websiteContent`). `world: "MAIN"` stays (Firefox 128+). The only code accommodation is `content.js` `cloneInto`-ing outbound bridge replies (Firefox Xray; no-op on Chrome). `npx web-ext lint` = 0/0/0.
- **Auto-release:** `extension-release.yml` cuts a **GitHub Release** on every push to `main` touching `extension/**`, `lib/commentScope.js`, or `package-extension.sh`. Hybrid versioning — if `manifest.json`'s version is unreleased it ships as-is (you bumped a minor/major), else CI auto-increments the patch and commits the bump back to `main` (via `GITHUB_TOKEN`, which doesn't re-trigger CI).
- **Store submits are manual** (`workflow_dispatch`), so tiny pushes never flood review: `extension-submit-cws.yml` pushes a Release's Chrome zip to the Chrome Web Store (needs the four `CWS_*` secrets); `extension-submit-amo.yml` submits the Release's firefox zip to addons.mozilla.org via `web-ext sign` (needs `AMO_JWT_ISSUER` + `AMO_JWT_SECRET`; the AMO add-on + first listed version are created once via the AMO web UI). Each auto Release carries both zips.
- **Kill-switch:** `GET /api/extension/status?v=<v>` (`lib/extensionPolicy.ts`) returns `ok | nag | block`, env-overridable via `KARABUDDY_EXT_LATEST` / `_MIN_SUPPORTED` / `_NAG_MESSAGE` / `_BLOCK_MESSAGE`. Keep `KARABUDDY_EXT_LATEST` tracking the CWS-published version. The extension pings it on load (`06-bootstrap.js`) → nag/block toast. `block` is break-glass only (it still keeps buffering recordings locally — a stopped recording is a permanently lost game).

Full runbook: [docs/extension-rollout.md](./docs/extension-rollout.md).

## Comment-scoping model (B71/B73 — read before touching tags)

A replay reaches a team **only via an explicit share** (`replay_team_shares`) — never merely because a member tagged it (that was the original cross-team leak). Each tag carries a **team scope** (`tag_team_scope` join table): a subset of the replay's shares. Empty scope = personal (author-only).

- **Bounds (enforced server-side in `lib/tagScope.resolveTagScope`):** `audience ⊆ replay shares ∩ author's team memberships`. Default (no explicit request) = all eligible shared teams. Anonymous authors → always personal.
- **Narrowing rule (`lib/commentScope.scopeFromMentions`):** 0 mentions → all armed teams (broadcast); ≥1 mention → union of the mentioned people's teams ∩ armed. This one file is shared byte-for-byte with the extension (`extension/replays/00-comment-scope.js`, parity-tested in `commentScope.parity.test.ts`) so the web chip and in-game form agree. It's a UX convenience — the server re-clamps.
- **Reads are scoped at every site:** discussion feed (scope inner-join), replay viewer (client-fetches `GET /api/replays/[slug]/tags` authed by session/`X-Install-Token`), mentions inbox (EXISTS gate). Exception (B131): the replay **owner** sees every tag on their own replay — feedback on your replay is addressed to you (anonymous reviewers' comments are always personal-scoped and would otherwise be invisible to the reviewee). Exception (B133): on a **public** replay (`public_at` set by the owner), non-identity-entitled viewers get ALL tags in REDACTED form (`lib/publicTags.ts` — aliased authors, mentions stripped, no identity fields).
- **Writes:** web `POST /tags` accepts `teamSlugs`; the extension upload applies its armed `shareTeamSlugs` as shares then scopes lifted tags. `backfillTagScopes` is a one-shot recovery for pre-B71 tags (run once at cutover, not idempotent).
- **Replies (B78):** a tag with `parent_tag_id` set is a one-level reply. It **inherits the parent's scope** (passed as the `requested` set to `resolveTagScope`, so it's still clamped to shares ∩ the replier's memberships) and the parent's frame, and auto-@mentions the parent author. A reply's scope ⊆ the parent's, so it never escapes the thread's audience.

## karabast upstream-drift canary (B80)

karabast can change its gamestate format without notice and silently break recording. `lib/karabastShape.js` (shared, byte-identical to `extension/replays/00-karabast-shape.js`) encodes the fields the pipeline depends on as a fixed enum of issue codes. The extension validates each match's first frame and, **only on structural drift**, fires a content-free beacon to `POST /api/extension/health` carrying *only* predefined codes + the ext version (the server drops anything not in `knownIssueCodes()` — the privacy guarantee). On by default, opt-out toggle in the bubble's idle panel (`karabuddyHealthOptOut` in storage; the SW gates on it), documented in `/privacy`. v1 records via structured logs (`[karabuddy] EXT-DRIFT`); a spike of one code across installs = drift. A table + push alert, and a server-side cron over recent prod replays reusing the same validator, are the noted next steps.

## Gotchas

- **Migration journal monotonicity.** Drizzle applies entries whose `when` is *greater* than the last-applied timestamp, so a non-monotonic `when` is **silently skipped** (table never created → runtime 500s). Keep `when` strictly increasing; `scripts/validate-migration-journal.js` guards this in CI (`test/unit/migration-journal.test.ts`) and again in the prod-build prebuild.
- **`.vercelignore` must stay anchored to `/extension/`.** Unanchored `extension/` also matched `app/api/extension/*` and stripped the status endpoint from the Vercel build.
- **Local ≠ prod DB.** Never `db:migrate` without confirming the target is `localhost:5434` — `.env.local` is prod. The backfill/migration scripts target whatever the env points at; for a deliberate prod run pass prod creds explicitly (`KARABUDDY_DB_DRIVER=pg POSTGRES_URL="<prod>" npx tsx scripts/...`).
- **Env precedence** `.env.development.local` > `.env.local`.
- **Backward compat is two-sided.** A shipped extension can't be force-updated, so server changes must stay additive w.r.t. the published wire shape (contract tests enforce it), and the server deploys before a new extension publishes.
- **Chrome UI uses the design system** ([ADR 0006](./docs/adr/0006-design-system.md)). Draw colors/radii/spacing from `app/_theme/karabuddyTokens.ts` (not raw hex). **Toggles** (on/off + multi-select) use `<LedToggle>` (`app/_components/LedToggle.tsx`) — the cyan-LED "cockpit" control mirroring the extension's `buildShareRow`; **other** controls use **themed MUI** (`app/_theme/karabuddyTheme.ts`, applied via `<KaraBuddyThemeProvider>` around `(app)`). Never native form controls — `test/unit/no-native-form-controls.test.ts` fails CI on any native `type=checkbox|radio`. The lifted gameboard keeps its own `app/_theme/theme.ts` (scoped to the board; the chrome theme is re-asserted over `TagSidebar`). Migration is incremental — much of the chrome is still inline-styled.
- **Migrations must be expand/contract** ([ADR 0005](./docs/adr/0005-safe-deploys-expand-contract.md)). Prod migrates during the build prebuild while the *previous* deployment is still live, so co-deployed migrations must be **additive** (new nullable/defaulted columns, new tables/indexes). Destructive DDL — `DROP COLUMN`/`DROP TABLE`/`RENAME`/`ALTER … TYPE`/`SET NOT NULL` — must ship as a **separate, later** deploy after the referencing code is gone. `scripts/validate-migration-safety.js` blocks non-additive DDL in CI (`test/unit/migration-safety.test.ts`) and the prod prebuild unless the `.sql` carries a `-- safe-migration: <why>` annotation. So removing a column = two deploys.

## Backlog

[BACKLOG.md](./BACKLOG.md) is the source of truth for outstanding work — the top-of-file conventions section explains the format. Highest used ID is **B147**; the next new task is **B148**. The autonomous loop pulls the first satisfiable task from `## Backlog`, moves it through `## In Progress`, and appends it to `## Done`.

## Related repos

- `~/code/karabast-dev/forceteki-client/` — karabast's open-source frontend (MIT). We lift the gameboard renderer for the `/r/[slug]` viewer; **don't** maintain a literal fork — copy what we need, keep their LICENSE on the lifted files, evolve independently.
