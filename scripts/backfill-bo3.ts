// B224: one-shot backfill of the conversion-aware stats `bo3` flag over
// existing lobbies. A Bo1 that karabast converted to a Bo3 recorded its game 1
// as bestOfOne, so its stored `bo3` is false; `reconcileLobbyBo3` reclassifies
// it (and is the same code the upload path now self-heals with). Idempotent —
// only lobbies with a Bo1→Bo3 conversion have anything to change.
//
// Run (confirm the target DB — never prod without intent):
//   KARABUDDY_DB_DRIVER=pg POSTGRES_URL="<db>" npx tsx scripts/backfill-bo3.ts
// Flags:
//   --limit=N   process at most N lobbies this run (batching)

import { sql } from 'drizzle-orm';
import { getDb } from '../lib/db';
import { replays } from '../lib/schema';
import { reconcileLobbyBo3 } from '../lib/bo3Reconcile';

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
  const db = getDb();

  // Only lobbies that actually converted (a bestOfOne AND a bestOfThree game) —
  // the rest have nothing to reconcile.
  const rows = (await db.execute(sql`
    select match->>'lobbyId' as lobby
    from ${replays}
    where match->>'lobbyId' is not null
    group by match->>'lobbyId'
    having bool_or(match->>'gamesToWinMode' = 'bestOfOne')
       and bool_or(match->>'gamesToWinMode' = 'bestOfThree')
  `)) as unknown as { rows: { lobby: string }[] };
  let lobbies = (rows.rows ?? (rows as any)).map((r: { lobby: string }) => r.lobby).filter(Boolean);
  if (Number.isFinite(limit)) lobbies = lobbies.slice(0, limit);

  console.log(`reconciling bo3 for ${lobbies.length} converted lobby(ies)`);
  let totalUpdated = 0, touched = 0;
  for (const lobbyId of lobbies) {
    try {
      const n = await reconcileLobbyBo3(lobbyId);
      if (n > 0) { totalUpdated += n; touched += 1; }
    } catch (e) {
      console.error(`lobby ${lobbyId} failed:`, e instanceof Error ? e.message : e);
    }
  }
  console.log(`done — updated ${totalUpdated} match row(s) across ${touched} lobby(ies)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
