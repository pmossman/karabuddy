// B234: one-shot / catch-up run of replay payload retention (the same logic the
// daily cron runs — lib/replayRetention.ts). Use it for the initial backlog,
// which is far too big for one cron invocation.
//
// Run (confirm the target DB — this deletes blobs for real):
//   KARABUDDY_DB_DRIVER=pg POSTGRES_URL="<db>" BLOB_READ_WRITE_TOKEN=... npx tsx scripts/prune-payloads.ts --dry-run
//   ... then again without --dry-run.
// Flags:
//   --dry-run        count + size only, delete nothing
//   --days=N         retention window (default: REPLAY_PAYLOAD_RETENTION_DAYS or 30)
//   --limit=N        stop after N rows
//   --batch=N        rows per delete batch (default 200)

import { pruneReplayPayloads } from '../lib/replayRetention';

async function main() {
  const args = process.argv.slice(2);
  const num = (k: string) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.split('=')[1]) : undefined; };
  const dryRun = args.includes('--dry-run');
  const res = await pruneReplayPayloads({ days: num('days'), limit: num('limit'), batch: num('batch'), dryRun, log: (m) => console.log(m) });
  console.log(JSON.stringify(res, null, 2));
  if (res.dryRun) console.log(`dry run: would prune ${res.pruned} replay payload(s), ${(res.rawBytes / 1073741824).toFixed(2)} GB raw`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
