// Manual win/loss result assignment. karabast's "leave game" uploads a full
// replay but declares no result, so `winners` stays null and the game is invisible
// to stats. This lets an owner assert the result: it writes `winners` from the
// OWNER's perspective (win → [ownerPlayerId], loss → [opponentId], clear → null)
// so every column-reader (W/L badge, result filter, deck win-rates, Bo3/sideboard)
// picks it up, AND re-materializes the aggregate stats facts (match_players /
// matches / card_events) so /stats + matchup win-rates move too.
//
// The `winnerManual` flag it sets makes the assignment authoritative — a later
// re-upload won't clobber it (see app/api/replays/route.ts upsert guard).

import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { replays, matches } from './schema';
import { persistReplayStats } from './replayStatsPersist';

export type ManualResult = 'win' | 'loss' | null;
export type SetResultOutcome = 'ok' | 'encrypted' | 'no-pov' | 'no-opponent';

export interface ReplayForResult {
  slug: string;
  gameId: string;
  ownerPlayerId: string | null;
  players: unknown; // jsonb: [{ id, username, leader, base, ... }]
  payloadBlobUrl: string;
  encrypted: boolean;
}

// Assumes the caller already authorized the mutation (canMutateReplay). Returns
// 'ok', or a skip reason the caller reports back (encrypted replays can't be read
// server-side; a game with no POV / no second player can't be scored).
export async function setReplayResult(replay: ReplayForResult, result: ManualResult): Promise<SetResultOutcome> {
  if (replay.encrypted) return 'encrypted';
  const pov = replay.ownerPlayerId;
  if (!pov) return 'no-pov';

  let winners: string[] | null = null;
  if (result === 'win') {
    winners = [pov];
  } else if (result === 'loss') {
    const players = Array.isArray(replay.players) ? (replay.players as Array<{ id?: string }>) : [];
    const opp = players.find((p) => p?.id && p.id !== pov);
    if (!opp?.id) return 'no-opponent';
    winners = [opp.id];
  }

  const db = getDb();
  await db.update(replays)
    .set({ winners, winnerManual: result !== null, resultSetAt: result !== null ? new Date() : null })
    .where(eq(replays.slug, replay.slug));

  if (result === null) {
    // Clearing → drop the materialized facts so the game leaves stats again
    // (delete by gameId cascades match_players + card_events).
    await db.delete(matches).where(eq(matches.gameId, replay.gameId));
    return 'ok';
  }

  // Win/loss → re-materialize stats via the SAME path an upload uses, with the
  // asserted winners. Best-effort: the column write above already drives the
  // badge/filter/deck-stats, so a stats blip must not fail the assignment.
  try {
    const res = await fetch(replay.payloadBlobUrl);
    if (res.ok) {
      const parsed = await res.json();
      await persistReplayStats(replay.slug, parsed, replay.gameId, winners);
    } else {
      console.error('[result] payload fetch', res.status, 'for', replay.slug);
    }
  } catch (e) {
    console.error('[result] stats re-persist failed for', replay.slug, e);
  }
  return 'ok';
}
