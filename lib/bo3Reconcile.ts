// B224: keep the stored stats `bo3` flag conversion-aware.
//
// `bo3` is extracted per-replay at upload from the recorded `gamesToWinMode`,
// with no lobby context — so a game that STARTS as Bo1 and is then converted to
// a Bo3 (its game 1) lands `bo3=false`. This reconciles a whole lobby's games
// against the conversion-aware `effectiveFormats`: a bestOfOne game immediately
// followed by Bo3 games (the converted game 1) is reclassified Bo3.
//
// Idempotent + self-healing: safe to run on every upload (the converted game 1
// gets fixed as soon as game 2 lands) and as a one-shot backfill. Win tally is
// per RECORDER (karabast's per-game player UUIDs aren't stable across a lobby,
// but a single recorder's ownerPlayerId is), matching the viewer's grouping.

import { eq, sql } from 'drizzle-orm';
import { getDb } from './db';
import { replays, matches } from './schema';
import { effectiveFormats, winsToWin } from './seriesGrouping';

interface Row {
  slug: string;
  gameId: string;
  userId: string | null;
  ownerToken: string;
  ownerPlayerId: string | null;
  winners: unknown;
  fmt: string | null;
  createdAt: Date;
  bo3: boolean | null;
}

// Reconcile every stats `matches` row in `lobbyId`. Returns the count updated.
export async function reconcileLobbyBo3(lobbyId: string): Promise<number> {
  const db = getDb();
  const rows = (await db
    .select({
      slug: replays.slug,
      gameId: replays.gameId,
      userId: replays.userId,
      ownerToken: replays.ownerToken,
      ownerPlayerId: replays.ownerPlayerId,
      winners: replays.winners,
      fmt: sql<string | null>`${replays.match}->>'gamesToWinMode'`,
      createdAt: replays.createdAt,
      bo3: matches.bo3,
    })
    .from(replays)
    .innerJoin(matches, eq(matches.gameId, replays.gameId))
    .where(sql`${replays.match}->>'lobbyId' = ${lobbyId}`)) as Row[];

  // Group by recorder — each recorder's own games are one stable series.
  const byRecorder = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.userId ?? `tok:${r.ownerToken}`;
    const list = byRecorder.get(key) ?? [];
    if (!byRecorder.has(key)) byRecorder.set(key, list);
    list.push(r);
  }

  // Desired bo3 per gameId. A game is Bo3 in ANY recorder's series → Bo3 (being
  // part of a converted set is objective; a recorder who missed game 1 can't
  // un-Bo3 it).
  const desired = new Map<string, boolean>();
  const current = new Map<string, boolean | null>();
  for (const games of byRecorder.values()) {
    games.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const wonOf = (g: Row): boolean | null => {
      const w = Array.isArray(g.winners) ? (g.winners as string[]) : null;
      if (!w || !g.ownerPlayerId) return null;
      return w.includes(g.ownerPlayerId);
    };
    const fmts = effectiveFormats(games, wonOf, (g) => g.fmt);
    games.forEach((g, i) => {
      const isBo3 = winsToWin(fmts[i]) > 1;
      desired.set(g.gameId, (desired.get(g.gameId) ?? false) || isBo3);
      current.set(g.gameId, g.bo3);
    });
  }

  let updated = 0;
  for (const [gameId, want] of desired) {
    if (current.get(gameId) !== want) {
      await db.update(matches).set({ bo3: want }).where(eq(matches.gameId, gameId));
      updated += 1;
    }
  }
  return updated;
}

// Convenience for the upload path: reconcile the lobby a freshly-persisted
// replay belongs to, swallowing errors (stats are best-effort, never block an
// upload). No-op when the replay carries no lobbyId.
export async function reconcileBo3ForReplay(match: unknown): Promise<void> {
  const lobbyId = (match as { lobbyId?: unknown })?.lobbyId;
  if (typeof lobbyId !== 'string' || !lobbyId) return;
  try {
    await reconcileLobbyBo3(lobbyId);
  } catch (e) {
    console.warn(`[bo3-reconcile] lobby ${lobbyId} failed:`, e instanceof Error ? e.message : e);
  }
}
