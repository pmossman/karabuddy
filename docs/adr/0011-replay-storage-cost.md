# ADR 0011 — Replay storage cost: compress, prune, and keep the store portable

**Status:** Accepted (B234) · 2026-09-08

## Context

Measured on 2026-09-08 against prod: 136.5k replays, **47.9 GB** of raw JSON in
Vercel Blob, growing ~17 GB/month, median payload 317 kB. Only 7.7k replays had
ever been opened; 43 GB belonged to replays nobody viewed. Every game also wrote a
snapshot every 5 minutes (~360k blob writes/month). The Neon database was 2.0 GB,
1.4 GB of it `card_events`.

The goal is to keep karabuddy running for free while development attention moves
to swuforge. Vercel's Hobby plan allows 1 GB of Blob storage and **2k Blob writes
a month**, so Vercel Blob can't hold karabuddy's write volume on a free tier no
matter how small the blobs are. Cloudflare R2's free tier (10 GB, 1M writes/month,
no egress fees) can — it is also what swuforge already uses.

## Decision

1. **Compress every payload with gzip before it is stored** (`lib/blob.ts
   putPayload`, level 9). Sampled ratio 24x (320 kB → 13 kB). Readers never see
   the difference: `lib/payloadFetch.ts` sniffs the gzip magic and inflates with
   the platform `DecompressionStream`; server code uses `readBlobText`/
   `readBlobJson`. Legacy plain-JSON blobs keep working. `payload_size_bytes`
   still records the RAW length; `payload_encoding` records how the body is
   stored.
2. **Make the store a driver** (`KARABUDDY_BLOB_DRIVER`): `vercel` (default),
   `s3` (Cloudflare R2 via the S3 API, objects carry `Content-Encoding: gzip`
   so browsers inflate natively), `memory` (tests). Reads and deletes route by
   URL, so rows on both stores coexist while `scripts/migrate-payloads.ts`
   moves them.
3. **Retention** (`lib/replayRetention.ts`): delete the payload blob of any
   replay older than `REPLAY_PAYLOAD_RETENTION_DAYS` (default 30) that nobody
   has ever opened, unless it is public, clipped, or sent for review. "Opened"
   = a `replay_views` row (signed-in) or `replays.last_viewed_at` (stamped for
   every viewer by `/api/replays/[slug]/viewed`). The row and every derived
   fact (matches, card_events, openings, sideboards, tags) stay — ADR 0007
   materialized them at upload precisely so the blob is not needed for stats.
   Pruned rows get `payload_pruned_at`; the viewer shows an "expired" notice;
   a later snapshot upload re-writes the blob and clears the mark. Runs daily
   from a Vercel cron (`/api/cron/prune-payloads`, `CRON_SECRET`), with
   `scripts/prune-payloads.ts` for the initial backlog.
4. **Fewer mid-match snapshots**: the extension uploads every 15 minutes
   instead of 5 and skips a snapshot when nothing new was captured
   (`extension/replays/03-recorder.js`). The pagehide upload still covers
   tab-close; the interval only bounds what a hard crash loses.

## Consequences

- Blob footprint after prune + compression: roughly 1–2 GB and ~0.7 GB/month of
  new writes before retention reclaims them, i.e. inside R2's free tier with
  room to spare; on Vercel Pro the Blob line drops to cents.
- Vercel Blob on Hobby is still not viable (2k writes/month): going free on
  Vercel means Hobby for compute + R2 for payloads.
- A replay nobody opened for 30 days loses playback. Team review flows are
  protected (reviews, clips, public), and anonymous viewers now count as views.
- Two schema columns + a partial index (migration 0045). `payload_pruned_at`
  must be respected by every server-side reader; they all go through
  `readBlobJson`, which returns null for a missing blob.
- The database is NOT addressed here. `card_events` (6.6M rows, 1.4 GB) keeps
  the DB above Neon's 0.5 GB free tier; that needs its own decision (compact the
  table, aggregate it like swuforge's `cardStats` jsonb, or move providers).

## Rejected

- **Diffed persisted format like swuforge's `PersistedTimeline`** — karabuddy's
  payload is already patch-based per frame; gzip captures most of the remaining
  redundancy, and a format change would touch the decoder, the viewer and the
  extension for a smaller win than compression alone.
- **Serving payloads through a Function (private bucket)** — costs a function
  invocation + Fast Data Transfer per view; public objects with free R2 egress
  are cheaper and simpler.
- **Count-based per-user caps (swuforge's 500/750)** — karabuddy's value is the
  unviewed long tail being cheap, not bounded; age + views prunes what actually
  costs money without capping active users.
