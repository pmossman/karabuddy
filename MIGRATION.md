# Free-tier migration — checklist

Goal: run karabuddy for $0/month. Target stack: **Vercel Hobby** (compute + daily
cron) + **Cloudflare R2** (replay payloads) + **CockroachDB Basic** (database).
Background: ADR 0011 (storage), ADR 0012 (DB size), BACKLOG B234/B235.

**Nothing in Phase 0 or Phase 1 touches production.** The new stack runs as a
*shadow*: a second Vercel project (`karabuddy-shadow`) deployed from the
`free-tier-migration` branch, with its own CockroachDB database (a copy of prod)
and its own R2 bucket. `main`, karabuddy.app, the Neon database and the Vercel
Blob store are not changed until Phase 2, and PR #28 / #29 stay unmerged until
then. The shadow carries no prod Blob token and has payload deletion disabled,
so it *cannot* delete a prod blob even by mistake.

Claude drives this. Your items are short; each unlocks a batch of Claude's.
**To resume at any time:** open Claude Code in `~/code/karabuddy` and say
*"continue the free-tier migration (MIGRATION.md)"*. Claude keeps this file
current and appends to the log at the bottom.

---

## Phase 0 — stand up the shadow (no prod impact)

### Your items

- [x] **0.1 Give Claude Vercel CLI access.** ✅ 2026-09-12 (`vercel login` done) Unlocks: creating the shadow
      project, its env vars and redeploys. Two ways:
      - *Easiest:* create a token at https://vercel.com/account/settings/tokens
        (scope: your team, expiry as you like) and append `VERCEL_TOKEN=…` to
        `.env.local` (gitignored) or paste it in chat. Claude passes it as
        `vercel --token`.
      - *Or* run `vercel login` in a normal terminal window (NOT via Claude's
        `!` prefix — that has a 2-minute timeout and the device-code flow waited
        past it on 2026-09-12, which also wiped the old token). Visit the
        printed URL, approve, done.
- [x] **0.2 Cloudflare R2 bucket** ✅ 2026-09-12 — verified: gzip'd put, public GET with `Content-Encoding: gzip`, CORS for the shadow origin, delete. (~10 min, free tier, no card):
      1. Cloudflare dashboard → R2 → Create bucket → name `karabuddy-replays`,
         location Automatic. (Same account as swuforge is fine.)
      2. Bucket → Settings → **Public Development URL** → Enable → copy the
         `https://pub-….r2.dev` URL.
      3. Bucket → Settings → **CORS policy** → Add → paste Appendix B → Save.
      4. R2 → **Manage API tokens** → Create API token → permission
         *Object Read & Write*, scope *Apply to specific buckets only* →
         `karabuddy-replays` → Create. Copy the **Access Key ID** and **Secret
         Access Key** (shown once).
      5. Copy your **Account ID** (R2 overview page, right side).
      6. Hand the four values to Claude: paste them in chat, or append to
         `.env.local` as `R2_ACCOUNT_ID=`, `R2_ACCESS_KEY_ID=`,
         `R2_SECRET_ACCESS_KEY=`, `R2_PUBLIC_BASE_URL=` and say so.
      > `r2.dev` URLs are rate-limited and "for development" per Cloudflare; at
      > karabuddy's ~100 replay views/day that's fine. A custom domain needs
      > karabuddy.app's DNS on Cloudflare, so it's an optional later step.
- [x] **0.3 CockroachDB Cloud cluster** ✅ 2026-09-12 (~10 min, no card):
      1. https://cockroachlabs.cloud → sign up → Create cluster → **Basic** →
         AWS, **us-east-1** (same region as Vercel iad1) → name `karabuddy`.
      2. Create a SQL user (e.g. `karabuddy`), save the generated password.
      3. Connect → Connection string → copy the `postgresql://…?sslmode=verify-full`
         string (with the password filled in) → hand it to Claude (chat, or
         `COCKROACH_URL=` in `.env.local`). Claude creates two databases in the
         cluster: `shadow` (Phase 0) and, later, `karabuddy` (Phase 2).
- [x] **0.4 OAuth redirect URIs for the shadow domain** ✅ 2026-09-12 (sign-in verified by Parker). The shadow
      is **https://karabuddy-shadow.vercel.app**. Add:
      - Discord: https://discord.com/developers/applications → your KaraBuddy
        app → OAuth2 → Redirects → Add →
        `https://karabuddy-shadow.vercel.app/api/auth/callback/discord` → Save.
      - Google: https://console.cloud.google.com/apis/credentials → the
        KaraBuddy OAuth client → Authorized redirect URIs → Add →
        `https://karabuddy-shadow.vercel.app/api/auth/callback/google` → Save.
      Without this you can still browse the shadow, but not sign in.

### Claude's items

- [x] 0.A Code + tests on branch `free-tier-migration` — PR #28 (open, unmerged)
- [x] 0.B Contract migration 0047 — PR #29 (draft, unmerged)
- [x] 0.C Shadow safety: `KARABUDDY_PAYLOAD_DELETE_DISABLED`, no-token guard for
      Vercel Blob URLs, `copy-db --skip`, `migrate-payloads --keep-old
      --skip-existing`
- [x] 0.D *(after 0.1)* Vercel project **`karabuddy-shadow`** created on the team
      (2026-09-12). It is deliberately **not git-linked** — it deploys with
      `vercel deploy --prod` from a plain clone of the branch at
      `~/karabuddy-shadow` (the same way CI deploys prod), so nothing on GitHub
      can ever trigger it and `main` is never involved. Env per Appendix A
      "shadow" column: auth + cron + retention + `KARABUDDY_DB_DRIVER=pg` +
      `KARABUDDY_PAYLOAD_DELETE_DISABLED=1`, `KARABUDDY_BLOB_DRIVER=s3` + `R2_*`
      are set; NO `BLOB_READ_WRITE_TOKEN`, NO `DISCORD_*`. Still pending:
      `POSTGRES_URL*` (after 0.3). Shadow-only values for local scripts live in
      `~/code/karabuddy/.env.shadow.local` (gitignored).
      > Quirk: the Vercel CLI treats `~/code` as a project root (there's a
      > `~/code/.gitignore`), so a shadow clone under `~/code` kept linking the
      > wrong directory — hence `~/karabuddy-shadow`. The prod link in
      > `~/code/karabuddy/.vercel` is untouched.
- [x] 0.E Database `shadow` on the cluster: 47 migrations applied; prod copied
      in from one REPEATABLE READ snapshot (`copy-db --skip=card_events`), all
      31 tables' row counts match; card facts filled via `copy-card-facts`
      (262,260 sides). ✅ 2026-09-12
- [x] 0.F Shadow deployed via `scripts/deploy-shadow.sh` →
      **https://karabuddy-shadow.vercel.app** (home 200, cron 401 without the
      secret, extension status OK, viewer/lists render). ✅ 2026-09-12
- [x] 0.G Shadow data complete (2026-09-12 21:18): 95,610 replays (60-day
      window + public), 24,761 decklists / 94,782 rows with deck refs, 44,967
      payloads marked expired (nothing deleted), 50,643 payloads on R2
      (gzip'd, 332 MB stored). Shadow viewer reads from R2.

## Phase 1 — get confident (still no prod impact)

- [ ] **1.1 (you) Dogfood the shadow.** Point your own extension at it: on a
      karabast.net tab, DevTools console →
      `chrome.storage.local.set({ karabuddyEndpoint: 'https://<shadow-url>' })`
      (the extension already allows `*.vercel.app`). Play a few games, watch
      replays, use stats/teams. To go back: `chrome.storage.local.remove('karabuddyEndpoint')`.
- [ ] 1.A (Claude) Watch the shadow for a week: Vercel usage numbers
      (invocations, active CPU) vs Hobby limits, Cockroach RU usage vs the 50M
      free, R2 ops; error logs; a full-suite run of the API tests against the
      shadow DB. Record in the log.
- [ ] 1.B (Claude) Rehearse the cutover copy against a scratch database to time
      it (expect minutes).
- [ ] **1.2 (you) Go / no-go.** If the shadow is solid, Phase 2. If not, nothing
      has changed in prod; the shadow project and R2 bucket can simply be deleted.

## Phase 2 — cutover (the only phase that touches prod)

### Your items (in order; Claude ticks "ready" before each)

- [x] **2.1 Merge PR #28** ✅ 2026-09-13 (merged by Claude at Parker's go; deploy run 34776315191) (https://github.com/pmossman/karabuddy/pull/28) — the
      CI gate deploys the code + expand migrations to prod (Neon). Prod keeps
      running exactly as before, just with gzip'd new uploads and the retention
      cron (inert until `CRON_SECRET` exists).
- [ ] **2.2 Merge PR #29** (https://github.com/pmossman/karabuddy/pull/29) —
      after Claude ticks ready (PR #28 live). Drops `card_events`, −1.4 GB.
- [ ] **2.3 Downgrade Vercel to Hobby** — after Claude ticks ready (DB + payloads
      cut over and verified). Vercel → team Settings → Billing → Downgrade.
      Hobby is non-commercial use only; the other projects on the team stay.
- [ ] **2.4 Delete the Vercel Blob store** — after Claude ticks ready.
- [ ] **2.5 Delete the Neon database** — a week after cutover with no issues.
- [ ] **2.6 Ship the extension update** (15-min snapshots) — **ready**: CI cut release `ext-v1.2.1` on the merge. Actions →
      *extension-submit-cws* → Run workflow. Or tell Claude to trigger it.

### Claude's items

- [ ] 2.A *(after 2.1)* ✅ Move 1 verified 2026-09-13 19:11: 49 migrations applied, 24,936 decklists / 143,686 rows with refs, new uploads gzip'd with refs and no embedded decks, home/viewer/stats/teams 200, og-image renders a gzip'd payload. Remaining for 2.A: set `CRON_SECRET` + set `CRON_SECRET` +
      `REPLAY_PAYLOAD_RETENTION_DAYS` on prod; run `prune-payloads` (dry, then
      real: ~83k blobs / 28 GB); tick 2.2-ready.
- [ ] 2.B *(after 2.2)* Verify `card_events` is gone; DB size.
- [ ] 2.C Cutover window (Appendix C, ~15 min, quiet hour): pause prod project →
      create database `karabuddy` on the cluster, apply migrations, `copy-db
      --skip=card_events` from Neon → `migrate-payloads --skip-existing` (reuses
      the R2 objects the shadow already uploaded; only the delta is new) → flip
      prod env to Cockroach + R2 → redeploy → unpause → smoke. Tick 2.3-ready and
      2.4-ready.
- [ ] 2.D Delete the shadow project + `shadow` database; tick 2.5-ready after a
      week; tick 2.6-ready once CI has cut the extension release.
- [ ] 2.E Final: record before/after costs + sizes in the log; update ADRs.

---

## Appendix A — env vars (Vercel)

| Var | shadow project | prod at cutover |
|---|---|---|
| `KARABUDDY_DB_DRIVER` | `pg` | `pg` |
| `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING` | cluster URL, database `shadow` | cluster URL, database `karabuddy` |
| `KARABUDDY_BLOB_DRIVER` | `s3` | `s3` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | from 0.2 | same |
| `R2_BUCKET` | `karabuddy-replays` | same |
| `R2_PUBLIC_BASE_URL` | the `https://pub-….r2.dev` URL, no trailing slash | same |
| `BLOB_READ_WRITE_TOKEN` | **unset** (cannot touch prod blobs) | keep until 2.4 |
| `KARABUDDY_PAYLOAD_DELETE_DISABLED` | `1` | unset |
| `CRON_SECRET` | `openssl rand -hex 32` | its own |
| `REPLAY_PAYLOAD_RETENTION_DAYS`, `NEXT_PUBLIC_REPLAY_RETENTION_DAYS` | `30` | `30` |
| `AUTH_SECRET`, `AUTH_DISCORD_*`, `AUTH_GOOGLE_*` | same as prod (sessions/accounts are copied) | unchanged |
| `KARABUDDY_PUBLIC_URL` | the shadow URL | unchanged |
| `DISCORD_BOT_TOKEN`, `DISCORD_*_WEBHOOK_URL` | **unset** | unchanged |

Env changes take effect on the next deploy (Claude redeploys).

## Appendix B — R2 CORS policy

```json
[
  {
    "AllowedOrigins": ["https://karabuddy.app", "https://karabuddy.vercel.app", "https://karabuddy-shadow.vercel.app", "http://localhost:3000", "http://localhost:3001"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["Content-Encoding", "Content-Length"],
    "MaxAgeSeconds": 86400
  }
]
```

(If the shadow gets a different `*.vercel.app` hostname, Claude will tell you
the exact origin to add.)

## Appendix C — database cutover plan (Claude runs it)

Pick a quiet hour (US early morning). Total window ≈ 15 min.

1. Pause the prod Vercel project. Uploads fail closed; the extension keeps the
   recording locally and shows "Not yet uploaded", so nothing is lost
   permanently.
2. Copy Neon → the cluster's `karabuddy` database (`copy-db --skip=card_events`,
   verified row counts). Point rows at R2 (`migrate-payloads --skip-existing`;
   the shadow already uploaded almost everything, so this is the delta).
3. Flip the prod env (Appendix A "prod at cutover" column). Redeploy. Unpause.
4. Smoke: open a replay, upload a test replay, load /stats and a team page.
5. Rollback (any time before 2.5): flip the env back to the Neon/Blob values
   and redeploy. Uploads that landed on Cockroach in between would be lost,
   which is why the window is short and quiet.

## Log

- 2026-09-12 — Checklist created. PR #28 (expand) and PR #29 (contract, draft)
  opened but **not merged** — they wait for Phase 2. Waiting on your 0.1–0.3.
- 2026-09-12 — 0.1 done (CLI login). Created Vercel project `karabuddy-shadow`
  (not git-linked; deploys from `~/karabuddy-shadow`) and loaded its
  DB/R2-independent env. Next: 0.2 (R2) and 0.3 (Cockroach) from you; then
  Claude copies the DB, deploys, and posts the shadow URL.
- 2026-09-12 — 0.2 done: R2 bucket verified end to end with the app's own
  driver; R2 env loaded on `karabuddy-shadow`. Only 0.3 (Cockroach connection
  string) blocks the first shadow deploy.
- 2026-09-12 — 0.3 done: cluster reachable (also from Vercel's build network);
  database `shadow` created, 47 migrations applied.
- 2026-09-12 — **INCIDENT (no user-visible impact).** Claude chained
  `vercel deploy --prod` after git commands that ran in `~/code/karabuddy`,
  which is linked to the PROD project — so the branch was deployed to prod, not
  the shadow. The build failed at typecheck (a gitignored local script got
  uploaded), so **no new code went live** (prod still serves the 26-day-old
  deployment; home, viewer and extension status all 200; uploads kept landing).
  But the build's prebuild had already applied migrations **0045 + 0046 to the
  prod Neon DB** (additive only: 3 nullable columns, a partial index, and the
  `match_players.card_events` backfill — running code ignores them; +~140 MB).
  Consequence handled: old prod code keeps writing `card_events` rows but not
  the jsonb, so new migration **0047** (in PR #28) re-runs the backfill for
  rows still null at the real deploy; PR #29's drop is renumbered to 0048.
  Guard added: `scripts/deploy-shadow.sh` is now the only way the shadow gets
  deployed — it refuses unless the directory is `~/karabuddy-shadow`, linked to
  `karabuddy-shadow`, on branch `free-tier-migration`.
- 2026-09-12 — Shadow is UP: https://karabuddy-shadow.vercel.app, on the
  `shadow` Cockroach DB (full prod copy) + R2. Retention marking + payload copy
  into R2 running. Waiting on your 0.4 (two OAuth redirect URIs) to sign in.
- 2026-09-12 — 0.4 done; Parker signed in on the shadow. Phase 1 (dogfooding)
  can start while the payload copy into R2 finishes in the background.
- 2026-09-12 — **Shadow DB DISABLED: CockroachDB free allowance exhausted.**
  Basic's free tier is a $15/month credit per organization (= 50M request
  units + 10 GiB); over that the cluster is switched off until the next
  billing month (Oct 1) or a paid limit is set ($0.20 per extra 1M RUs).
  Claude's scripts burned it in one day: three full bulk loads, the retention
  marking (90k row updates) and — the real culprit — `migrate-payloads`
  re-selecting "oldest still-unmigrated row" every page, a full table scan
  per 32 rows (fixed: keyset paging). 29,220 of ~54k payloads made it into
  R2 (529 MB) before the cutoff; `--skip-existing` picks those up. The
  shadow site 500s until the DB is back. Also a finding in its own right:
  karabuddy's ~360k uploads/month × ~60 row writes each is on the order of
  the whole free RU budget by itself, so Cockroach Basic is probably a
  $2–10/month database for karabuddy, not a free one. Decision needed — see
  chat 2026-09-12.
- 2026-09-12 — Neon dashboard read: **76.6 CU-hours in 12 days (~190/month)**
  at an always-on 0.25 CU, 2.45 GB storage. Neon Free (100 CU-h, 0.5 GB) is
  out on compute regardless of size. Swuforge's DB measured read-only: 387 MB
  for 58,452 games (~2.6 KB/game) vs karabuddy ~5.2 KB/game × 144k. **Decision:
  database → Aiven free PostgreSQL** (1 GB, no metering, PG 18, 20 connections
  → `KARABUDDY_PG_POOL_MAX=2`). Shadow DB re-created there from the fixed
  scripts; Cockroach cluster parked (delete after Oct 1). Size work queued:
  decks normalization (swuforge pattern), client_meta.ua drop, players trim,
  90-day retention of replay rows.
  Note: Aiven uses a private CA → URLs use `sslmode=no-verify` for now; for
  the real cutover, pin Aiven's CA (`certs/aiven-ca.pem` + `sslrootcert`).
  Aiven free is PG 18, 20 connections (shadow runs `KARABUDDY_PG_POOL_MAX=2`),
  "up to 8 GB disk" per its docs; its disk guard briefly flips the DB read-only
  during bulk loads (copy-db now retries + paces itself).
- 2026-09-12 — B236 built on branch `b236-decklists` (to merge into the
  migration branch once e2e is green): decklists normalized (swuforge pattern,
  −~120 MB), user agent dropped (−17 MB), opt-in `REPLAY_ROW_RETENTION_DAYS`.
  Shadow on Aiven: redeployed and serving; prod copy re-running with the
  read-only-guard fix.
- 2026-09-12 (later) — B236 merged into `free-tier-migration` (PR #28) after a
  missed reader (sideboard guides) was moved onto the hydrator; e2e green.
  PR #29 rebuilt as the full contract: migration 0049 = re-run the deck_refs
  backfill, `DROP TABLE card_events`, `DROP COLUMN replays.decks`. Shadow load
  on Aiven now skips the embedded `decks` column entirely (`copy-db
  --drop-cols=replays.decks` + `scripts/copy-decklists.ts` derives the
  `decklists` rows from prod in TypeScript), so Aiven never stores the 136 MB.
  Aiven's disk guard (flips the DB read-only, kills connections) tripped three
  times during bulk loads at ~350–400 MB of data — WAL from the load, not the
  data itself; it clears within a minute or two. Fine for karabuddy's normal
  write rate, but it means the free instance's disk headroom is ~1 GB in
  practice: keep the DB ≤ ~0.6 GB (PR #29 + the 90-day rule do that).
- 2026-09-12 (evening) — At 613 MB (all big tables, no decks) Aiven's guard
  stayed ON for >10 min: the free instance's usable disk is ~1 GB minus
  system/WAL/backup overhead, i.e. the full 144k-replay dataset does not fit.
  **Decision (Parker): 60-day blanket retention + card facts for recorded
  seats only (B237).** Shadow reloading with `copy-db --since-days=60`
  (95.5k replays kept, 49k dropped); `REPLAY_ROW_RETENTION_DAYS=60` set on the
  shadow. Expected shadow DB ≈ 380 MB.
- 2026-09-12 (night) — Shadow load complete on Aiven (see 0.G). Aiven disk
  reading from Parker: **68% at 504 MB of data** → ~1 GB disk, ~320 MB
  headroom. Decision: **60 days stands**, with a tripwire — if the guard trips
  under normal traffic during dogfooding, drop to 45 days (~55% disk). The
  derivation passes (deck refs, prune marks, R2 URLs) each rewrote the
  `replays` table once, so it bloated to 582 MB; VACUUM FULL result in the
  next entry. Lesson for the real cutover: apply those passes on prod BEFORE
  copying, so the copy is a single clean pass with no bloat.
  Guard-tolerant scripts: `aiven-finish2.sh` (retries each idempotent step).
- 2026-09-13 — Dogfooding on the shadow confirmed working. Parker chose to
  move prod over in three steps: **Move 1** code only (PR #28 merged, data
  stays on Neon + Blob; retention cron inert without CRON_SECRET), **Move 2**
  payloads → R2 (a day later), **Move 3** DB → Aiven (quiet morning, 15-min
  window; Neon kept a week as rollback). Then Hobby downgrade.
- 2026-09-13 19:11 — **Move 1 live** (deploy run 34776315191 green). Prod on
  new code, data still on Neon + Blob. Extension release ext-v1.2.1 cut
  automatically (CWS submit is item 2.6). Next: Move 2 tomorrow.
