// B227: materialize sideboard decisions for a lobby. A sideboard is the
// transition INTO a Bo3 game (2, 3, …): the recorder's decklist for that game
// diffed against their previous game in the same MATCH. Runs on upload (a game
// arriving completes the transition before it) and as a backfill; idempotent +
// self-healing — we rebuild the whole lobby's facts each time.
//
// Only the recorder's own games count (their per-game player UUID isn't stable
// across a lobby, but each replay carries its ownerPlayerId), and only WITHIN a
// match (B224 conversion-aware segmentation) — a fresh Bo1 or a new set that
// follows is not a sideboard of the prior game.

import { eq, sql } from 'drizzle-orm';
import { getDb } from './db';
import { replays, replaySideboards } from './schema';
import { segmentMatches } from './seriesGrouping';
import { computeSwap, SIDEBOARD_EXTRACTOR_VERSION, type SideCard } from './sideboardExtract';

interface Row {
  slug: string;
  userId: string | null;
  ownerToken: string;
  ownerPlayerId: string | null;
  winners: unknown;
  decks: unknown;
  fmt: string | null;
  createdAt: Date;
}

const recorderDeck = (decks: unknown, playerId: string | null): { deck: SideCard[]; sideboard: SideCard[] } | null => {
  if (!playerId || !decks || typeof decks !== 'object') return null;
  const d = (decks as Record<string, { deck?: SideCard[] | null; sideboard?: SideCard[] | null }>)[playerId];
  if (!d || !Array.isArray(d.deck)) return null;
  return { deck: d.deck, sideboard: Array.isArray(d.sideboard) ? d.sideboard : [] };
};

// Rebuild every sideboard fact in `lobbyId`. Returns the count written.
export async function reconcileLobbySideboards(lobbyId: string): Promise<number> {
  const db = getDb();
  const rows = (await db
    .select({
      slug: replays.slug,
      userId: replays.userId,
      ownerToken: replays.ownerToken,
      ownerPlayerId: replays.ownerPlayerId,
      winners: replays.winners,
      decks: replays.decks,
      fmt: sql<string | null>`${replays.match}->>'gamesToWinMode'`,
      createdAt: replays.createdAt,
    })
    .from(replays)
    .where(sql`${replays.match}->>'lobbyId' = ${lobbyId}`)) as Row[];

  // Group by recorder — one stable series per recorder.
  const byRecorder = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.userId ?? `tok:${r.ownerToken}`;
    const list = byRecorder.get(key) ?? [];
    if (!byRecorder.has(key)) byRecorder.set(key, list);
    list.push(r);
  }

  type Fact = typeof replaySideboards.$inferInsert;
  const facts: Fact[] = [];
  for (const games of byRecorder.values()) {
    games.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const wonOf = (g: Row): boolean | null => {
      const w = Array.isArray(g.winners) ? (g.winners as string[]) : null;
      if (!w || !g.ownerPlayerId) return null;
      return w.includes(g.ownerPlayerId);
    };
    for (const match of segmentMatches(games, wonOf, (g) => g.fmt)) {
      // game i (i≥1) is a sideboard transition off game i-1 within the match.
      for (let i = 1; i < match.games.length; i++) {
        const prev = match.games[i - 1];
        const cur = match.games[i];
        const prevDeck = recorderDeck(prev.decks, prev.ownerPlayerId);
        const curDeck = recorderDeck(cur.decks, cur.ownerPlayerId);
        if (!prevDeck || !curDeck || !cur.ownerPlayerId) continue; // need both decklists
        const { swappedIn, swappedOut } = computeSwap(prevDeck.deck, curDeck.deck);
        facts.push({
          replaySlug: cur.slug,
          previousSlug: prev.slug,
          recorderId: cur.ownerPlayerId,
          lobbyId,
          gameNumber: i + 1,
          deck: prevDeck.deck,
          sideboard: prevDeck.sideboard,
          swappedIn,
          swappedOut,
          wonPrevious: wonOf(prev),
          extractorVersion: SIDEBOARD_EXTRACTOR_VERSION,
        });
      }
    }
  }

  // Rebuild: drop the lobby's facts, insert the current set. Responses key on
  // replays.slug (not this table) so they survive. Cheap — lobbies are small.
  await db.delete(replaySideboards).where(eq(replaySideboards.lobbyId, lobbyId));
  if (facts.length) await db.insert(replaySideboards).values(facts).onConflictDoNothing();
  return facts.length;
}

// Upload hook: reconcile the lobby a freshly-persisted replay belongs to.
// Best-effort (never blocks an upload); no-op without a lobbyId.
export async function reconcileSideboardsForReplay(match: unknown): Promise<void> {
  const lobbyId = (match as { lobbyId?: unknown })?.lobbyId;
  if (typeof lobbyId !== 'string' || !lobbyId) return;
  try {
    await reconcileLobbySideboards(lobbyId);
  } catch (e) {
    console.warn(`[sideboard-reconcile] lobby ${lobbyId} failed:`, e instanceof Error ? e.message : e);
  }
}
