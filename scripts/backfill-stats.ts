// B101/P0 (ADR 0007): one-shot backfill of Stats/Meta facts over existing
// replays. Fetches each payload blob, decodes it, and runs the same
// persistReplayFacts the upload path uses. Idempotent + resumable: by default
// it skips any replay whose gameId already has facts, so a re-run continues
// where it left off.
//
// Run (confirm the target DB — never prod without intent):
//   KARABUDDY_DB_DRIVER=pg POSTGRES_URL="<db>" npx tsx scripts/backfill-stats.ts
// Flags:
//   --force            re-persist every replay (refresh facts) instead of skipping
//   --limit=N          process at most N replays this run (batching)
//   --concurrency=N    process N replays in parallel (default 1). Each replay is
//                      ~90% idle waiting on blob-fetch + Neon round-trips, so this
//                      is near-linear; pair with KARABUDDY_PG_POOL_MAX>=N so the
//                      DB pool isn't the bottleneck.
//   <slug>             backfill only that one replay

import { eq } from 'drizzle-orm';
import { getDb } from '../lib/db';
import { replays, matches } from '../lib/schema';
import { decodeReplay } from '../lib/replayDecoder';
import { persistReplayFacts } from '../lib/statsPersist';

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
  const slugArg = args.find((a) => !a.startsWith('--'));
  const db = getDb();

  let rows = slugArg
    ? await db.select().from(replays).where(eq(replays.slug, slugArg))
    : await db.select().from(replays);

  // Resumable: skip replays whose gameId already has facts (unless --force).
  if (!force && !slugArg) {
    const done = new Set((await db.select({ gameId: matches.gameId }).from(matches)).map((r) => r.gameId));
    rows = rows.filter((r) => !done.has(r.gameId));
  }
  const offsetArg = args.find((a) => a.startsWith('--offset='));
  const offset = offsetArg ? Number(offsetArg.split('=')[1]) : 0;
  if (offset > 0) rows = rows.slice(offset);
  if (Number.isFinite(limit)) rows = rows.slice(0, limit);
  const concArg = args.find((a) => a.startsWith('--concurrency='));
  const concurrency = Math.max(1, concArg ? Number(concArg.split('=')[1]) : 1);

  console.log(`backfilling stats for ${rows.length} replay(s)${force ? ' (force)' : ''} @ concurrency ${concurrency}`);
  let ok = 0, skipped = 0, failed = 0, done = 0;
  const failReasons = new Map<string, number>();
  const started = Date.now();

  const processOne = async (row: (typeof rows)[number]) => {
    try {
      const res = await fetch(row.payloadBlobUrl);
      if (!res.ok) { skipped++; return; }
      const decoded = decodeReplay(JSON.parse(await res.text()));
      // persistReplayFacts is NON-transactional (Neon HTTP has no interactive
      // transactions), so a concurrent-deadlock failure would leave the replay
      // half-written. Deadlocks (mostly on the shared cards catalog) are
      // transient — retry with backoff so every replay lands consistent.
      let r;
      for (let attempt = 1; ; attempt++) {
        try {
          r = await persistReplayFacts({
            decoded,
            replaySlug: row.slug,
            gameId: row.gameId,
            winners: (row.winners as string[] | null) ?? null,
            ownerPlayerId: row.ownerPlayerId ?? null,
            durationMs: row.durationMs ?? null,
          });
          break;
        } catch (e) {
          if (attempt >= 8) throw e;
          await new Promise((rz) => setTimeout(rz, attempt * 200 + Math.random() * 300));
        }
      }
      if (r.matchWritten) ok++; else skipped++;
    } catch (e: any) {
      failed++;
      // Bucket by reason (strip ids/params) so the tail shows a clean breakdown.
      const reason = String(e?.message || e).replace(/[0-9a-f-]{20,}/g, '<id>').slice(0, 60);
      failReasons.set(reason, (failReasons.get(reason) ?? 0) + 1);
    } finally {
      done++;
      if (done % 500 === 0 || done === rows.length) {
        const rate = done / ((Date.now() - started) / 1000);
        const eta = Math.round((rows.length - done) / rate / 60);
        console.log(`  ${done}/${rows.length} (${rate.toFixed(1)}/s, ~${eta}m left) — ok ${ok}, skip ${skipped}, fail ${failed}`);
      }
    }
  };

  // Simple worker pool: `concurrency` workers pull from a shared cursor.
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
      while (cursor < rows.length) await processOne(rows[cursor++]);
    }),
  );
  console.log(`done — ${ok} ok, ${skipped} skipped, ${failed} failed in ${Math.round((Date.now() - started) / 1000)}s`);
  if (failReasons.size) {
    console.log('failure reasons:');
    for (const [reason, n] of [...failReasons.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${n}\t${reason}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
