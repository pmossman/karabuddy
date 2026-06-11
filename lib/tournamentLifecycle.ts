// B124: round creation shared by POST .../start (round 1) and POST .../rounds
// (complete current + pair next). Pure orchestration over lib/swiss.ts.
//
// No db.transaction here — the prod neon-http driver doesn't support
// transactions (see the B101 stats fix). Atomicity is approximated by the
// UNIQUE (tournament_id, number) index: a concurrent double-pair loses the
// round insert and the whole call 409s before any matches are written.

import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  tournamentEntrants,
  tournamentMatches,
  tournamentRounds,
  type TournamentEntrant,
  type TournamentMatch,
} from '@/lib/schema';
import { computeStandings, pairRound, type SwissMatch } from '@/lib/swiss';
import { generateSlug } from '@/lib/slug';

export function toSwissMatches(matches: Pick<TournamentMatch, 'entrant1Id' | 'entrant2Id' | 'games'>[]): SwissMatch[] {
  return matches.map((m) => ({
    entrant1Id: m.entrant1Id,
    entrant2Id: m.entrant2Id,
    games: (m.games as { winner: string | null }[]) ?? [],
  }));
}

export interface CreateRoundResult {
  ok: true;
  roundId: string;
  number: number;
  pairings: number;
  bye: boolean;
}
export interface CreateRoundError {
  ok: false;
  status: number;
  error: string;
}

// Pairs + persists round `number`. Caller has already validated tournament
// status and (for next-rounds) completed the previous round.
export async function createRound(
  tournamentId: string,
  number: number,
  entrants: TournamentEntrant[],
  priorMatches: Pick<TournamentMatch, 'entrant1Id' | 'entrant2Id' | 'games'>[]
): Promise<CreateRoundResult | CreateRoundError> {
  const active = entrants.filter((e) => !e.dropped);
  if (active.length < 2) {
    return { ok: false, status: 409, error: 'need at least 2 active entrants' };
  }

  const db = getDb();
  const seed = generateSlug('seed_', 12);
  const swissPrior = toSwissMatches(priorMatches);
  const standings = computeStandings(
    entrants.map((e) => ({ id: e.id, dropped: e.dropped })),
    swissPrior,
    tournamentId
  );
  const { pairings, byeEntrantId } = pairRound({ standings, priorMatches: swissPrior, seed });

  const roundId = generateSlug('tr_', 8);
  try {
    await db.insert(tournamentRounds).values({
      id: roundId,
      tournamentId,
      number,
      pairingSeed: seed,
    });
  } catch (err: any) {
    for (let e = err; e; e = e.cause) {
      if (e?.code === '23505' || String(e?.constraint || e?.message || '').includes('tournament_rounds_tournament_number_idx')) {
        return { ok: false, status: 409, error: 'round already paired' };
      }
    }
    throw err;
  }

  const rows = pairings.map(([a, b], i) => ({
    id: generateSlug('tm_', 8),
    roundId,
    tournamentId,
    tableNumber: i + 1,
    entrant1Id: a,
    entrant2Id: b as string | null,
    games: [] as { winner: string | null }[],
    status: 'pending',
  }));
  if (byeEntrantId) {
    // Bye = pre-confirmed 2-0 win so it renders as a card + counts in standings.
    rows.push({
      id: generateSlug('tm_', 8),
      roundId,
      tournamentId,
      tableNumber: rows.length + 1,
      entrant1Id: byeEntrantId,
      entrant2Id: null,
      games: [{ winner: byeEntrantId }, { winner: byeEntrantId }],
      status: 'confirmed',
    });
  }
  if (rows.length > 0) await db.insert(tournamentMatches).values(rows as any);

  return { ok: true, roundId, number, pairings: pairings.length, bye: !!byeEntrantId };
}

export async function loadEntrantsAndMatches(tournamentId: string) {
  const db = getDb();
  const [entrants, matches, rounds] = await Promise.all([
    db.select().from(tournamentEntrants).where(eq(tournamentEntrants.tournamentId, tournamentId)),
    db.select().from(tournamentMatches).where(eq(tournamentMatches.tournamentId, tournamentId)),
    db.select().from(tournamentRounds).where(eq(tournamentRounds.tournamentId, tournamentId)),
  ]);
  return { entrants, matches, rounds };
}
