# Free-tier migration — checklist

Goal: run karabuddy for $0/month. Target stack: **Vercel Hobby** (compute + daily
cron) + **Cloudflare R2** (replay payloads) + **CockroachDB Basic** (database).
Background: ADR 0011 (storage), ADR 0012 (DB size), BACKLOG B234/B235.

Claude drives this. Your items are the short list below; each one unlocks a
batch of Claude's. **To resume at any time:** open Claude Code in
`~/code/karabuddy` and say *"continue the free-tier migration (MIGRATION.md)"*.
Claude keeps this file current and appends to the log at the bottom.

## Your items (in order)

- [ ] **1. Merge PR #1** — https://github.com/pmossman/karabuddy/pull/28 — the code + expand migrations (B234 + B235). CI runs
      the full gate (typecheck, unit, api, e2e, smoke) and deploys to prod.
      Either merge on GitHub or tell Claude "merge PR 1".
- [ ] **2. `vercel login` once**, so Claude can set env vars and redeploy for
      you. In a Claude Code session type `! vercel login` and finish the browser
      step. (The stored CLI token has expired.) *Alternative:* set the env vars
      in Appendix A yourself in the Vercel dashboard and tick this anyway.
- [ ] **3. Cloudflare R2 bucket** (~10 min, free tier, no card):
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
- [ ] **4. CockroachDB Cloud cluster** (~10 min, no card):
      1. https://cockroachlabs.cloud → sign up → Create cluster → **Basic** →
         AWS, **us-east-1** (same region as Vercel iad1) → name `karabuddy`.
      2. Create a SQL user (e.g. `karabuddy`), save the generated password.
      3. Connect → Connection string → copy the `postgresql://…?sslmode=verify-full`
         string (with the password filled in) → hand it to Claude (chat, or
         `COCKROACH_URL=` in `.env.local`).
- [ ] **5. Merge PR #2** — https://github.com/pmossman/karabuddy/pull/29 — (contract migration: drops the old `card_events`
      table, reclaims 1.4 GB). **Only after Claude ticks "5-ready" below** — it
      must deploy after PR #1 is live.
- [ ] **6. Downgrade Vercel to Hobby** — only after Claude ticks "6-ready".
      Vercel → team Settings → Billing → Downgrade Plan. Hobby is
      non-commercial use only; the other projects on the team stay.
- [ ] **7. Delete the Vercel Blob store** — only after Claude ticks "7-ready"
      (payloads fully moved to R2). Vercel → Storage → the Blob store → Delete.
- [ ] **8. Delete the Neon database** — a week after cutover with no issues
      (Claude ticks "8-ready"). Vercel → Storage → Neon → remove / Neon console.
- [ ] **9. Ship the extension update** (15-min snapshots): GitHub → Actions →
      *extension-submit-cws* → Run workflow (defaults). Or tell Claude to
      trigger it. Claude ticks "9-ready" once the release is cut.

## Claude's items

- [x] A. Code + tests: B234 (storage) + B235 (DB size), ADR 0011/0012 — **PR #1** (#28)
- [x] B. Contract migration 0047 (`DROP TABLE card_events`) — **PR #2** (#29, draft)
- [ ] C. *(after 1)* Verify the deploy: migrations 0045/0046 applied, cron
      route answers 401 without the secret, viewer + upload smoke.
- [ ] D. *(after 1)* Prune the payload backlog: `scripts/prune-payloads.ts`
      dry-run, then real (~83k blobs, ~28 GB). Verify blob count/size after.
- [ ] E. *(after 2)* Set `CRON_SECRET`, `REPLAY_PAYLOAD_RETENTION_DAYS=30`,
      `NEXT_PUBLIC_REPLAY_RETENTION_DAYS=30` on prod, redeploy, invoke the cron
      once with the secret and confirm it prunes.
- [ ] F. *(after 3)* Set `KARABUDDY_BLOB_DRIVER=s3` + `R2_*` on prod, redeploy,
      upload smoke (new replay lands on R2 and plays back), then
      `scripts/migrate-payloads.ts` to move the remaining ~53k blobs
      (gzip'd, ~0.8 GB). Verify, then tick **7-ready**.
- [ ] G. *(after 1 is live)* tick **5-ready**; *(after 5)* verify `card_events`
      is gone and record the DB size.
- [ ] H. *(after 4)* Cockroach: apply migrations to the cluster, rehearsal copy
      with `scripts/copy-db.ts` (timing + row-count check), then the cutover
      (Appendix C), verify, tick **6-ready** and start the clock for **8-ready**.
- [ ] I. *(after 1)* Extension auto-patch release is cut by CI → tick **9-ready**.
- [ ] J. Final: record before/after costs + sizes in the log; update ADRs.

## Appendix A — env vars (prod, Vercel)

| Var | Value | When |
|---|---|---|
| `CRON_SECRET` | `openssl rand -hex 32` | step E |
| `REPLAY_PAYLOAD_RETENTION_DAYS` | `30` | step E |
| `NEXT_PUBLIC_REPLAY_RETENTION_DAYS` | `30` | step E |
| `KARABUDDY_BLOB_DRIVER` | `s3` | step F |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | from step 3 | step F |
| `R2_BUCKET` | `karabuddy-replays` | step F |
| `R2_PUBLIC_BASE_URL` | the `https://pub-….r2.dev` URL, no trailing slash | step F |
| `KARABUDDY_DB_DRIVER` | `pg` | cutover |
| `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING` | the Cockroach connection string | cutover |

Env changes only take effect on the next deploy (Claude redeploys).

## Appendix B — R2 CORS policy

```json
[
  {
    "AllowedOrigins": ["https://karabuddy.app", "https://karabuddy.vercel.app", "http://localhost:3000", "http://localhost:3001"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["Content-Encoding", "Content-Length"],
    "MaxAgeSeconds": 86400
  }
]
```

## Appendix C — database cutover plan (Claude runs it)

Pick a quiet hour (US early morning). Total window ≈ 15–20 min.

1. Rehearsal (no window): `drizzle-kit migrate` against the cluster, then
   `SOURCE_URL=<neon> TARGET_URL=<cockroach> npx tsx scripts/copy-db.ts` into a
   scratch database to time it and confirm every table's row count matches.
   Drop the scratch DB.
2. Cutover: pause the Vercel project (uploads fail closed; the extension keeps
   the recording locally and shows "Not yet uploaded", so nothing is lost
   permanently). Copy into the real database. Flip the three env vars in
   Appendix A. Redeploy. Unpause. Smoke: open a replay, upload a test replay,
   load /stats and a team page.
3. Rollback (any time before step 8): flip the env vars back to the Neon values
   and redeploy. Uploads that landed on Cockroach in between would be lost,
   which is why the window is short and quiet.

## Log

- 2026-09-12 — Checklist created. PR #1 = #28 (expand), PR #2 = #29 (contract,
  draft). Waiting on your item 1.
