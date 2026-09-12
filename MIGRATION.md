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

- [ ] **0.1 Give Claude Vercel CLI access.** Unlocks: creating the shadow
      project, its env vars and redeploys. Two ways:
      - *Easiest:* create a token at https://vercel.com/account/settings/tokens
        (scope: your team, expiry as you like) and append `VERCEL_TOKEN=…` to
        `.env.local` (gitignored) or paste it in chat. Claude passes it as
        `vercel --token`.
      - *Or* run `vercel login` in a normal terminal window (NOT via Claude's
        `!` prefix — that has a 2-minute timeout and the device-code flow waited
        past it on 2026-09-12, which also wiped the old token). Visit the
        printed URL, approve, done.
- [ ] **0.2 Cloudflare R2 bucket** (~10 min, free tier, no card):
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
- [ ] **0.3 CockroachDB Cloud cluster** (~10 min, no card):
      1. https://cockroachlabs.cloud → sign up → Create cluster → **Basic** →
         AWS, **us-east-1** (same region as Vercel iad1) → name `karabuddy`.
      2. Create a SQL user (e.g. `karabuddy`), save the generated password.
      3. Connect → Connection string → copy the `postgresql://…?sslmode=verify-full`
         string (with the password filled in) → hand it to Claude (chat, or
         `COCKROACH_URL=` in `.env.local`). Claude creates two databases in the
         cluster: `shadow` (Phase 0) and, later, `karabuddy` (Phase 2).
- [ ] **0.4 OAuth redirect URIs for the shadow domain** (2 min, after Claude
      posts the shadow URL in the log): add
      `https://<shadow-url>/api/auth/callback/discord` to the Discord app and
      `https://<shadow-url>/api/auth/callback/google` to the Google OAuth client.
      Without this you can still browse the shadow, but not sign in.

### Claude's items

- [x] 0.A Code + tests on branch `free-tier-migration` — PR #28 (open, unmerged)
- [x] 0.B Contract migration 0047 — PR #29 (draft, unmerged)
- [x] 0.C Shadow safety: `KARABUDDY_PAYLOAD_DELETE_DISABLED`, no-token guard for
      Vercel Blob URLs, `copy-db --skip`, `migrate-payloads --keep-old
      --skip-existing`
- [ ] 0.D *(after 0.1)* Create Vercel project `karabuddy-shadow` on the team,
      linked to the repo, **production branch = `free-tier-migration`** (so its
      "production" deploys never involve `main`). Env per Appendix A "shadow"
      column — notably NO `BLOB_READ_WRITE_TOKEN`, NO `DISCORD_*` (the Discord
      code gates on VERCEL_ENV=production, and a shadow must not post to real
      channels), `KARABUDDY_PAYLOAD_DELETE_DISABLED=1`.
- [ ] 0.E *(after 0.3)* Create database `shadow` on the cluster, apply
      migrations, copy prod into it with `scripts/copy-db.ts --skip=card_events`
      (read-only on prod; ~600 MB, minutes). Verify row counts.
- [ ] 0.F *(after 0.2 + 0.D)* Deploy the shadow; smoke it: viewer plays a replay
      (served from prod Blob, read-only), stats + team pages, cron route 401s.
      Post the shadow URL in the log → unlocks 0.4.
- [ ] 0.G *(after 0.E)* Run retention on the shadow DB (marks rows, deletes
      nothing), then `migrate-payloads --keep-old` to copy the surviving ~53k
      payloads into R2 (gzip'd, ~0.8 GB). Shadow viewer now reads from R2.

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

- [ ] **2.1 Merge PR #28** (https://github.com/pmossman/karabuddy/pull/28) — the
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
- [ ] **2.6 Ship the extension update** (15-min snapshots): Actions →
      *extension-submit-cws* → Run workflow. Or tell Claude to trigger it.

### Claude's items

- [ ] 2.A *(after 2.1)* Verify prod deploy; set `CRON_SECRET` +
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
