// B221: one-shot backfill of OPENING facts over existing replays, so the
// Openings drill tab launches with the back catalog. Fetches each payload
// blob, decodes it, and runs the same persistOpening the upload path uses.
// Idempotent + resumable: by default it skips any replay that already has an
// opening row at the current extractor version, so a re-run continues where
// it left off (and an extractor bump naturally re-processes everything).
// Encrypted replays are excluded — the server can never decode them (ADR 0010).
//
// Run (confirm the target DB — never prod without intent):
//   KARABUDDY_DB_DRIVER=pg POSTGRES_URL="<db>" npx tsx scripts/backfill-openings.ts
// Flags:
//   --force        re-extract every replay instead of skipping
//   --limit=N      process at most N replays this run (batching)
//   <slug>         backfill only that one replay

import { eq } from 'drizzle-orm';
import { getDb } from '../lib/db';
import { replays, replayOpenings } from '../lib/schema';
import { decodeReplay } from '../lib/replayDecoder';
import { persistOpening } from '../lib/openingPersist';
import { OPENING_EXTRACTOR_VERSION } from '../lib/openingExtract';

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

  const encrypted = rows.filter((r) => r.encrypted).length;
  rows = rows.filter((r) => !r.encrypted);

  // Resumable: skip replays already extracted at this version (unless --force).
  if (!force && !slugArg) {
    const done = new Set(
      (
        await db
          .select({ slug: replayOpenings.replaySlug })
          .from(replayOpenings)
          .where(eq(replayOpenings.extractorVersion, OPENING_EXTRACTOR_VERSION))
      ).map((r) => r.slug),
    );
    rows = rows.filter((r) => !done.has(r.slug));
  }
  if (Number.isFinite(limit)) rows = rows.slice(0, limit);

  console.log(
    `backfilling openings for ${rows.length} replay(s)${force ? ' (force)' : ''}` +
      (encrypted ? ` — ${encrypted} encrypted excluded` : ''),
  );
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
      if (await persistOpening(decoded, row.slug)) {
        console.log(`  ${row.slug}: ok`);
        ok++;
      } else {
        console.log(`  ${row.slug}: skip (no usable setup)`);
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
