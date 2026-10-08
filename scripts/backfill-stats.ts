// B101/P0 (ADR 0007): backfill / re-persist Stats/Meta facts from stored replay
// payloads. Fetches each payload, decodes it, and runs the same persistReplayFacts
// the upload path uses (upserts: idempotent, matches.created_at kept). Core in
// lib/statsBackfill.ts. Needs only DB credentials: payload URLs are public.
//
// Run (confirm the target DB — never prod without intent):
//   KARABUDDY_DB_DRIVER=pg POSTGRES_URL="<db>" npx tsx scripts/backfill-stats.ts [flags] [<slug>]
// Selection (pick one):
//   <slug>               re-persist just that replay
//   --slugs-file=PATH    re-persist exactly the replays listed (one slug per line;
//                        blanks and `#` comments ignored) — the repair / re-run mode.
//                        Failed slugs are written to --failed-file (default
//                        PATH.failed) so `--slugs-file=PATH.failed` retries them.
//   (neither)            every replay; skips games that already have facts
//                        unless --force, then --offset / --limit
// Flags:
//   --force              with no selection: re-persist every replay
//   --offset=N --limit=N with no selection: batching
//   --concurrency=N      replays in parallel (default 1). Each replay is ~90% idle
//                        on blob fetch + DB round-trips, so this is near-linear;
//                        with the pg driver pair it with KARABUDDY_PG_POOL_MAX>=N.
//   --dry-run            resolve the selection, report found / missing / pruned,
//                        write nothing
//   --failed-file=PATH   where to write failed slugs (slugs-file mode)
//   --progress=N         progress line every N replays (default 500, 100 with a slugs file)

import { readFileSync, writeFileSync } from 'node:fs';
import { backfillStats, parseSlugList } from '../lib/statsBackfill';

async function main() {
  const args = process.argv.slice(2);
  const val = (k: string) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : undefined; };
  const num = (k: string) => { const v = val(k); if (v === undefined) return undefined; const n = Number(v); if (!Number.isFinite(n)) throw new Error(`bad --${k}: ${v}`); return n; };
  const known = ['force', 'dry-run', 'slugs-file', 'failed-file', 'offset', 'limit', 'concurrency', 'progress'];
  for (const a of args) if (a.startsWith('--') && !known.includes(a.slice(2).split('=')[0])) throw new Error(`unknown flag ${a}`);

  const slugsFile = val('slugs-file');
  const slugArg = args.find((a) => !a.startsWith('--'));
  if (slugsFile && slugArg) throw new Error('pass either <slug> or --slugs-file, not both');
  const slugs = slugsFile ? parseSlugList(readFileSync(slugsFile, 'utf8')) : slugArg ? [slugArg] : undefined;
  const force = args.includes('--force');
  const dryRun = args.includes('--dry-run');
  const concurrency = num('concurrency') ?? 1;

  const what = slugsFile ? `${slugs!.length} listed slug(s) from ${slugsFile}` : slugArg ? `replay ${slugArg}` : force ? 'every replay (force)' : 'replays without facts';
  console.log(`${dryRun ? 'DRY RUN — ' : ''}backfilling stats for ${what} @ concurrency ${concurrency}`);

  const s = await backfillStats({
    slugs, force, dryRun, concurrency,
    offset: num('offset'), limit: num('limit'),
    progressEvery: num('progress') ?? (slugsFile ? 100 : 500),
    log: (l) => console.log(l),
  });

  if (dryRun) {
    console.log(`would re-persist ${s.selected - s.wouldSkipPruned} replay(s); ${s.wouldSkipPruned} have a pruned payload (would skip); ${s.missing.length} listed slug(s) not found`);
    return;
  }
  console.log(`done — ${s.ok} ok, ${s.skipped} skipped, ${s.failed} failed (of ${s.selected}${s.missing.length ? `; ${s.missing.length} listed slug(s) not found` : ''})`);
  const reasons = Object.entries(s.failReasons).sort((a, b) => b[1] - a[1]);
  if (reasons.length) {
    console.log('failure reasons:');
    for (const [reason, n] of reasons) console.log(`  ${n}\t${reason}`);
  }
  if (slugsFile) {
    const failedFile = val('failed-file') ?? `${slugsFile}.failed`;
    writeFileSync(failedFile, s.failedSlugs.length ? s.failedSlugs.join('\n') + '\n' : '');
    console.log(`${s.failedSlugs.length} failed slug(s) written to ${failedFile}${s.failedSlugs.length ? ` — re-run with --slugs-file=${failedFile}` : ''}`);
  }
  if (s.failed) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
