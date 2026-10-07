// B101/P0 (ADR 0007): materialize a replay's mined facts into Postgres,
// idempotent on gameId. Called from the upload path, manual result assignment
// and the backfill. Steps:
//   1. self-heal the card catalog — insert any observed cardId not yet known
//      (covers spoiler-season cards; known cards left untouched);
//   2. upsert the match row, then upsert one row per seat, so a re-upload of
//      the same game overwrites in place, never duplicates.

import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { getDb } from './db';
import { cards, matches, matchPlayers } from './schema';
import { aggregateCardEvents, extractReplayFacts, type ExtractOptions } from './statsExtract';
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

  // 2. Upsert the match + its seats.
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

  // Two single-statement upserts, no delete and no read-then-write. Each
  // statement is atomic on its own, so this works on every driver (the prod Neon
  // HTTP driver has no interactive transactions) and is safe when two uploads of
  // the same game persist at once — which is the NORM for a co-recorded game:
  // both players' extensions upload the moment it ends. The old shape (read the
  // prior rows, delete the match, re-insert it and its seats) raced there: the
  // loser hit matches_pkey / a match_players FK or PK error and its recorder's
  // facts were lost, or silently wiped without an error.
  //
  // The match row keeps its created_at (the date filters key on it), so a
  // re-persist (manual result, backfill --force, a later upload) doesn't move
  // the game to the day it was re-persisted.
  await db
    .insert(matches)
    .values({
      gameId: matchFact.gameId,
      replaySlug,
      format: matchFact.format,
      cardPool: matchFact.cardPool,
      bo3: matchFact.bo3,
      result: matchFact.result,
      durationMs: matchFact.durationMs,
    })
    .onConflictDoUpdate({
      target: matches.gameId,
      set: {
        replaySlug: sql`excluded.replay_slug`,
        format: sql`excluded.format`,
        cardPool: sql`excluded.card_pool`,
        bo3: sql`excluded.bo3`,
        result: sql`excluded.result`,
        durationMs: sql`excluded.duration_ms`,
      },
    });

  // B235: card facts ride on the side's own row (event → cardId → first frame).
  // B237 (DB size): they are kept for RECORDED seats only — the opponent side of
  // a single-recorder game carries no facts. A co-recorded game (both players
  // upload) must keep BOTH recorders' facts, though each upload only has its own:
  // so a seat stays a recorded seat once any upload recorded it, and its card
  // facts + resourcing rating come only from the upload made FROM that seat.
  // The merge happens inside the upsert, row-atomically, so it can't race.
  const cardMaps = aggregateCardEvents(events);
  const fromRecorderSeat = (c: AnyPgColumn) =>
    sql`case when excluded.is_recorder then excluded.${sql.identifier(c.name)} when ${matchPlayers.isRecorder} then ${c} else null end`;
  await db
    .insert(matchPlayers)
    .values(
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
          cardEvents: p.isRecorder ? (cardMaps.get(p.playerId) ?? null) : null,
          ...ratingCols(p.playerId),
        };
      }),
    )
    .onConflictDoUpdate({
      target: [matchPlayers.gameId, matchPlayers.playerId],
      set: {
        username: sql`excluded.username`,
        leader: sql`excluded.leader`,
        base: sql`excluded.base`,
        aspects: sql`excluded.aspects`,
        won: sql`excluded.won`,
        opponentLeader: sql`excluded.opponent_leader`,
        opponentBase: sql`excluded.opponent_base`,
        format: sql`excluded.format`,
        isRecorder: sql`${matchPlayers.isRecorder} or excluded.is_recorder`,
        cardEvents: fromRecorderSeat(matchPlayers.cardEvents),
        resourceAvailable: fromRecorderSeat(matchPlayers.resourceAvailable),
        resourceWasted: fromRecorderSeat(matchPlayers.resourceWasted),
        resourceForced: fromRecorderSeat(matchPlayers.resourceForced),
        resourceUnderspend: fromRecorderSeat(matchPlayers.resourceUnderspend),
        resourceDeadCards: fromRecorderSeat(matchPlayers.resourceDeadCards),
        resourceCountedRounds: fromRecorderSeat(matchPlayers.resourceCountedRounds),
      },
    });

  return { matchWritten: true, cardEvents: events.length };
}
