// B101/P0 (ADR 0007): one-shot backfill of Stats/Meta facts over existing
// replays. Fetches each payload blob, decodes it, and runs the same
// persistReplayFacts the upload path uses. Idempotent + resumable: by default
// it skips any replay whose gameId already has facts, so a re-run continues
// where it left off.
//
// Run (confirm the target DB — never prod without intent):
//   KARABUDDY_DB_DRIVER=pg POSTGRES_URL="<db>" npx tsx scripts/backfill-stats.ts
// Flags:
//   --force        re-persist every replay (refresh facts) instead of skipping
//   --limit=N      process at most N replays this run (batching)
//   <slug>         backfill only that one replay

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
  if (Number.isFinite(limit)) rows = rows.slice(0, limit);

  console.log(`backfilling stats for ${rows.length} replay(s)${force ? ' (force)' : ''}`);
  let ok = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const res = await fetch(row.payloadBlobUrl);
      if (!res.ok) {
        console.log(`  ${row.slug}: skip (blob ${res.status})`);
        skipped++;
        continue;
      }
      const parsed = JSON.parse(await res.text());
      const decoded = decodeReplay(parsed);
      const r = await persistReplayFacts({
        decoded,
        replaySlug: row.slug,
        gameId: row.gameId,
        winners: (row.winners as string[] | null) ?? null,
        ownerPlayerId: row.ownerPlayerId ?? null,
        durationMs: row.durationMs ?? null,
      });
      if (r.matchWritten) {
        console.log(`  ${row.slug}: ok (${r.cardEvents} card events)`);
        ok++;
      } else {
        console.log(`  ${row.slug}: skip (no final gamestate)`);
        skipped++;
      }
    } catch (e: any) {
      console.log(`  ${row.slug}: FAIL ${e?.message || e}`);
      failed++;
    }
  }
  console.log(`done — ${ok} ok, ${skipped} skipped, ${failed} failed`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
