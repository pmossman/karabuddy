# Local dev database (B74)

Local dev must NOT run against production. Today `.env.local` points at the
prod Neon DB — which is how a local `db:migrate` ended up touching prod and
why a missing local table surfaced as prod-shaped 500s. Give local its own
database, seeded from a prod snapshot for realistic data.

## One-time setup — create a separate DB (Neon branch, ~2 min)

A Neon branch is a copy-on-write fork of prod: instant, isolated, cheap.

1. https://console.neon.tech → your project → **Branches** → **Create branch**.
   Name it e.g. `dev-local`, branch from `production` (or `main`).
2. Open the new branch → **Connection string** → copy both the pooled and
   the direct (non-pooling) strings.
3. In `.env.local`, set `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING` to the
   **branch** strings (not prod). That's it — local now reads/writes the
   branch, prod is untouched.
4. `npm run db:migrate` to bring the branch up to the latest schema.

(Alternative: a local Postgres via Docker — see `docker-compose.test.yml`'s
pattern — if you'd rather not use a Neon branch. The branch is simpler and
matches prod's PG16 exactly.)

## Seed realistic data from prod

`npm run db:pull-snapshot` dumps prod (read-only) and restores it into your
local DB. Set the two URLs in `.env.local` first:

```
SNAPSHOT_SOURCE_URL=<prod connection string>     # dumped, read-only
SNAPSHOT_TARGET_URL=<your local branch string>   # DROPPED + restored
```

Then:

```
npm run db:pull-snapshot          # prompts before clobbering TARGET
npm run db:pull-snapshot --yes    # skip the prompt
```

Guards: both URLs are required and must differ (no defaulting off
`POSTGRES_URL`), so prod can't accidentally be both source and target. The
restore is destructive on TARGET only. Requires `pg_dump`/`pg_restore` (PG16
client tools: `brew install postgresql@16`).

Notes:
- **Blob payloads aren't copied.** `replays.payloadBlobUrl` keeps pointing at
  prod Vercel Blob URLs, which load fine read-only from local — so replays
  still play back without copying gigabytes.
- **PII:** the snapshot includes real user rows (emails, install/extension
  tokens). It's the same data you already had when local pointed at prod;
  just keep the branch private and don't commit dumps.

## Relation to previews (B72)

Same root cause as B72's preview-DB isolation — one shared DB. The Neon–
Vercel integration can auto-create a branch per *preview deploy* too; this
doc covers the *local* case. Both should stop sharing prod.
