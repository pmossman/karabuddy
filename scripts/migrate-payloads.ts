// B234 (storage cost): re-write existing replay payload blobs through the CURRENT
// storage driver — gzip-compressed, and (when KARABUDDY_BLOB_DRIVER=s3) moved from
// Vercel Blob to Cloudflare R2. Idempotent + resumable: a row is done once
// payload_encoding='gzip' AND its URL lives on the current store; re-runs skip it.
//
// Per row: read (any store/format) → gzip put at replays/<slug>.json on the current
// driver → update the row's URL/encoding → delete the old blob if the URL moved.
// Rows pruned by retention (payload_pruned_at) and inline data: URLs are skipped.
// Rows younger than --min-age-minutes (default 60) are skipped too: a game still
// streaming snapshots would just be re-written by its next upload anyway.
//
// Run it AFTER scripts/prune-payloads.ts so the backlog is as small as possible,
// and while still on the plan that holds the source blobs (reads are metered).
//
//   KARABUDDY_DB_DRIVER=pg POSTGRES_URL="<db>" BLOB_READ_WRITE_TOKEN=... \
//     [KARABUDDY_BLOB_DRIVER=s3 R2_*=...] npx tsx scripts/migrate-payloads.ts --dry-run
// Flags:
//   --dry-run              count only
//   --limit=N              stop after N rows
//   --concurrency=N        parallel rows (default 8; Vercel Blob allows 75 writes/s on Pro)
//   --min-age-minutes=N    skip rows created more recently than this (default 60)
//   --keep-old             don't delete the source blob when the URL moved (shadow env:
//                          the source is PROD's Blob store — always pass this there)
//   --skip-existing        s3 only: if the object already exists in the bucket (a
//                          rehearsal put it there), point the row at it instead of
//                          re-uploading

import { and, asc, isNull, lt, notLike, or, sql, eq, ne, not, like } from 'drizzle-orm';
import { getDb } from '../lib/db';
import { replays } from '../lib/schema';
import { blobDriver, deletePayloadBlobs, payloadExists, putPayload, readBlobText } from '../lib/blob';

const PAYLOAD_CACHE_MAX_AGE_SECONDS = 300; // mirrors app/api/replays/route.ts

async function main() {
  const args = process.argv.slice(2);
  const num = (k: string, d: number) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.split('=')[1]) : d; };
  const dryRun = args.includes('--dry-run');
  const keepOld = args.includes('--keep-old');
  const skipExisting = args.includes('--skip-existing');
  const limit = num('limit', Infinity);
  const concurrency = Math.max(1, num('concurrency', 8));
  const minAgeMin = num('min-age-minutes', 60);
  const db = getDb();

  const driver = blobDriver();
  const targetBase = driver === 's3' ? (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '') + '/' : null;
  console.log(`driver=${driver}${targetBase ? ` target=${targetBase}` : ''}${dryRun ? ' (dry run)' : ''}`);

  const cutoff = new Date(Date.now() - minAgeMin * 60_000);
  const notDone = targetBase
    ? or(isNull(replays.payloadEncoding), not(like(replays.payloadBlobUrl, `${targetBase}%`)))
    : isNull(replays.payloadEncoding);
  const where = and(isNull(replays.payloadPrunedAt), notLike(replays.payloadBlobUrl, 'data:%'), lt(replays.createdAt, cutoff), notDone);

  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(replays).where(where);
  console.log(`${n} replay(s) to migrate`);
  if (dryRun) return;

  let done = 0, failed = 0, missing = 0, reused = 0, rawBytes = 0, storedBytes = 0;
  const started = Date.now();
  // Page by created_at so a re-run after a crash resumes; each processed row
  // drops out of the WHERE, so always take the oldest remaining.
  while (done + failed + missing < limit) {
    const rows = await db
      .select({ slug: replays.slug, url: replays.payloadBlobUrl, createdAt: replays.createdAt })
      .from(replays)
      .where(where)
      .orderBy(asc(replays.createdAt))
      .limit(Math.min(concurrency * 4, limit - (done + failed + missing)));
    if (rows.length === 0) break;
    // A row that failed stays matched by WHERE → would be re-selected forever.
    // Bail after a full page of failures rather than spin.
    let pageFailed = 0;
    for (let i = 0; i < rows.length; i += concurrency) {
      await Promise.all(rows.slice(i, i + concurrency).map(async (row) => {
        try {
          if (skipExisting) {
            const existing = await payloadExists(`replays/${row.slug}.json`);
            if (existing) {
              await db.update(replays).set({ payloadBlobUrl: existing, payloadEncoding: 'gzip' }).where(and(eq(replays.slug, row.slug), eq(replays.payloadBlobUrl, row.url)));
              if (existing !== row.url && !keepOld) await deletePayloadBlobs([row.url]);
              reused++; done++;
              return;
            }
          }
          const text = await readBlobText(row.url);
          if (text === null) { missing++; pageFailed++; await db.update(replays).set({ payloadPrunedAt: new Date() }).where(eq(replays.slug, row.slug)); console.log(`  ${row.slug}: source blob missing → marked pruned`); return; }
          const res = await putPayload(`replays/${row.slug}.json`, text, { cacheControlMaxAge: PAYLOAD_CACHE_MAX_AGE_SECONDS });
          await db.update(replays).set({ payloadBlobUrl: res.url, payloadEncoding: res.encoding }).where(and(eq(replays.slug, row.slug), eq(replays.payloadBlobUrl, row.url)));
          if (res.url !== row.url && !keepOld) await deletePayloadBlobs([row.url]);
          done++; rawBytes += text.length; storedBytes += res.storedBytes;
        } catch (e) {
          failed++; pageFailed++;
          console.log(`  ${row.slug}: FAILED ${(e as Error).message}`);
        }
      }));
    }
    const secs = (Date.now() - started) / 1000;
    console.log(`${done} done, ${failed} failed, ${missing} missing · ${(rawBytes / 1048576).toFixed(0)} MB → ${(storedBytes / 1048576).toFixed(0)} MB · ${(done / secs).toFixed(1)}/s`);
    if (pageFailed === rows.length) { console.log('every row in the page failed — stopping'); break; }
  }
  console.log(JSON.stringify({ done, reused, failed, missing, rawMB: +(rawBytes / 1048576).toFixed(1), storedMB: +(storedBytes / 1048576).toFixed(1) }));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
