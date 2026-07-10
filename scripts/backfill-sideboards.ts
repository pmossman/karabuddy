// B227: one-shot backfill of sideboard-drill facts (replay_sideboards) over
// existing lobbies. Each game after the first in a recorder's series yields a
// "what did you swap" decision, diffed from the previous game's decklist.
// `reconcileLobbySideboards` is the same code the upload path self-heals with,
// and it REBUILDS a lobby's facts (delete + insert), so this is idempotent.
//
// Run (confirm the target DB — never prod without intent):
//   KARABUDDY_DB_DRIVER=pg POSTGRES_URL="<db>" npx tsx scripts/backfill-sideboards.ts
// Flags:
//   --limit=N   process at most N lobbies this run (batching)

import { sql } from 'drizzle-orm';
import { getDb } from '../lib/db';
import { replays } from '../lib/schema';
import { reconcileLobbySideboards } from '../lib/sideboardPersist';

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
  const db = getDb();

  // Only lobbies with 2+ recorded games — a single game can't produce a
  // between-games swap. reconcileLobbySideboards no-ops the rest internally.
  const rows = (await db.execute(sql`
    select match->>'lobbyId' as lobby
    from ${replays}
    where match->>'lobbyId' is not null
    group by match->>'lobbyId'
    having count(*) >= 2
  `)) as unknown as { rows: { lobby: string }[] };
  let lobbies = (rows.rows ?? (rows as any)).map((r: { lobby: string }) => r.lobby).filter(Boolean);
  if (Number.isFinite(limit)) lobbies = lobbies.slice(0, limit);

  console.log(`reconciling sideboards for ${lobbies.length} multi-game lobby(ies)`);
  let totalFacts = 0, touched = 0;
  for (const lobbyId of lobbies) {
    try {
      const n = await reconcileLobbySideboards(lobbyId);
      if (n > 0) { totalFacts += n; touched += 1; }
    } catch (e) {
      console.error(`lobby ${lobbyId} failed:`, e instanceof Error ? e.message : e);
    }
  }
  console.log(`done — ${totalFacts} sideboard decision(s) across ${touched} lobby(ies)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
