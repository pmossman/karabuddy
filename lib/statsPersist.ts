// B101/P0 (ADR 0007): materialize a replay's mined facts into Postgres,
// idempotent on gameId. Called from the upload path (non-blocking) + the
// backfill. Steps:
//   1. self-heal the card catalog — insert any observed cardId not yet known
//      (covers spoiler-season cards; known cards left untouched);
//   2. replace the match + its child facts in one transaction (delete by
//      gameId cascades match_players + card_events, then re-insert) so a
//      re-upload of the same game is a clean overwrite, never a duplicate.

import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { cards, matches, matchPlayers, cardEvents } from './schema';
import { extractReplayFacts, type ExtractOptions } from './statsExtract';
import { analyzeResourcing, summarizeResourcing, type ResourcingRating } from './resourcingAnalysis';
import type { DecodedReplay } from './replayDecoder';

export interface PersistInput extends ExtractOptions {
  decoded: DecodedReplay;
  replaySlug: string;
}

export async function persistReplayFacts(input: PersistInput): Promise<{ matchWritten: boolean; cardEvents: number }> {
  const { decoded, replaySlug, ...opts } = input;
  const { matchFact, cardEvents: events, observedCards } = extractReplayFacts(decoded, opts);
  // No final gamestate / players → nothing to record (e.g. a payload that
  // never produced a frame). Leave any prior facts in place.
  if (!matchFact) return { matchWritten: false, cardEvents: 0 };

  const db = getDb();

  // 1. Catalog self-heal — insert unknown cards from what we just observed.
  if (observedCards.length) {
    await db
      .insert(cards)
      .values(
        observedCards.map((c) => {
          const [set, num] = c.cardId.split('_');
          return {
            cardId: c.cardId,
            name: c.name,
            set: set || null,
            number: Number.isFinite(Number(num)) ? Number(num) : null,
            aspects: c.aspects,
            cost: c.cost,
            type: c.type,
            source: 'observed',
          };
        }),
      )
      .onConflictDoNothing();
  }

  // 2. Replace the match + children atomically.
  const players = matchFact.players;
  const opponentOf = (pid: string) => (players.length === 2 ? players.find((p) => p.playerId !== pid) ?? null : null);

  // Resourcing rating for the RECORDER (first-person). The efficiency metric
  // needs no card costs, so cost lookup is a no-op here; only the in-viewer
  // report (which surfaces cost-dependent regret flags) wires up the catalog.
  let recorderRating: ResourcingRating | null = null;
  const recorder = players.find((p) => p.isRecorder);
  if (recorder) {
    try {
      const rating = summarizeResourcing(analyzeResourcing(decoded.frames, { recorderId: recorder.playerId, costOf: () => null }));
      // Only persist a rating when there's something to rate (≥1 counted round);
      // games with no analyzable action spans stay null → out of the trend.
      if (rating.countedRounds > 0) recorderRating = rating;
    } catch (e) {
      console.error('[stats] resourcing rating failed for', replaySlug, e);
    }
  }
  const ratingCols = (pid: string) =>
    recorderRating && pid === recorder?.playerId
      ? {
          resourceAvailable: recorderRating.available,
          resourceWasted: recorderRating.wasted,
          resourceForced: recorderRating.forced,
          resourceUnderspend: recorderRating.underspend,
          resourceDeadCards: recorderRating.deadCards,
          resourceCountedRounds: recorderRating.countedRounds,
        }
      : {};

  await db.transaction(async (tx) => {
    await tx.delete(matches).where(eq(matches.gameId, matchFact.gameId)); // cascades children
    await tx.insert(matches).values({
      gameId: matchFact.gameId,
      replaySlug,
      format: matchFact.format,
      cardPool: matchFact.cardPool,
      bo3: matchFact.bo3,
      result: matchFact.result,
      durationMs: matchFact.durationMs,
    });
    await tx.insert(matchPlayers).values(
      players.map((p) => {
        const opp = opponentOf(p.playerId);
        return {
          gameId: matchFact.gameId,
          playerId: p.playerId,
          username: p.username,
          leader: p.leader,
          base: p.base,
          aspects: p.aspects,
          isRecorder: p.isRecorder,
          won: p.won,
          opponentLeader: opp?.leader ?? null,
          opponentBase: opp?.base ?? null,
          format: matchFact.format,
          ...ratingCols(p.playerId),
        };
      }),
    );
    if (events.length) {
      await tx.insert(cardEvents).values(
        events.map((e) => ({
          gameId: e.gameId,
          playerId: e.playerId,
          isRecorder: e.isRecorder,
          cardId: e.cardId,
          event: e.event,
          attribution: e.attribution,
          frameIndex: e.frameIndex,
          sideWon: e.sideWon,
          format: matchFact.format,
        })),
      );
    }
  });

  return { matchWritten: true, cardEvents: events.length };
}
