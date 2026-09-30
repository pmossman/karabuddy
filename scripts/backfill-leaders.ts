// Backfill leaders lost when karabast replaced players[pid].leader with
// players[pid].leaders[] (2026-09-29). Re-derives them from each replay's stored
// payload and fills `replays.players[].leader` and `match_players.leader /
// opponent_leader` where they are null. Idempotent: only null fields are written,
// so a re-run skips what is already fixed. See lib/leaderBackfill.ts.
//
// DRY RUN BY DEFAULT — prints what it would change. Pass --write to apply.
// Needs only DB credentials: payload URLs are public and fetched as-is.
//
//   KARABUDDY_DB_DRIVER=pg POSTGRES_URL="<db>" npx tsx scripts/backfill-leaders.ts [--write]
// Flags:
//   --write            apply the changes (default: dry run)
//   --since=<ISO>      only replays created at/after this (default 2026-09-29T00:00:00Z)
//   --limit=N          process at most N matching replays
//   --batch=N          rows fetched per page (default 50)
//   <slug>             only this replay

import { backfillLeaders, LEADERS_BROKE_AT } from '../lib/leaderBackfill';

async function main() {
  const args = process.argv.slice(2);
  const num = (k: string) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.split('=')[1]) : undefined; };
  const sinceArg = args.find((x) => x.startsWith('--since='));
  const since = sinceArg ? new Date(sinceArg.slice('--since='.length)) : LEADERS_BROKE_AT;
  if (Number.isNaN(since.getTime())) throw new Error(`bad --since: ${sinceArg}`);
  const write = args.includes('--write');
  const slug = args.find((a) => !a.startsWith('--'));

  console.log(`${write ? 'WRITE' : 'DRY RUN (pass --write to apply)'} — replays created since ${since.toISOString()}${slug ? `, slug ${slug}` : ''}`);
  const s = await backfillLeaders({ write, since, limit: num('limit'), batchSize: num('batch'), slug, log: (l) => console.log(l) });
  const verb = write ? 'fixed' : 'would fix';
  console.log(`found ${s.found} — ${verb} ${s.fixed}, partial ${s.partial}, still unresolvable ${s.unresolvable}`);
  for (const [reason, n] of Object.entries(s.reasons)) console.log(`  ${n}\t${reason}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
