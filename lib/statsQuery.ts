// B101/P1 (ADR 0007): the scoping + aggregation layer. Reads the materialized
// fact tables (match_players / matches / card_events) and produces the numbers
// the /stats UI renders — over one of three audiences:
//
//   personal — the signed-in user's own replays
//   team     — a team's shared replays (via replay_team_shares)
//   global   — everyone's, EXCLUDING uploaders who opted out, and only above a
//              minimum sample size (min-N) so no single game is identifiable
//
// Scope is a WHERE/JOIN over matches → replays (the uploader + shares), applied
// uniformly to every query here, so the three audiences can never leak into
// each other. Aggregation is plain SQL via the drizzle query builder (portable
// across neon / pg / pglite).

import { and, eq, isNull, isNotNull, or, sql } from 'drizzle-orm';
import { getDb } from './db';
import { matchPlayers, matches, replays, replayTeamShares, users, cardEvents } from './schema';

export type StatsScope =
  | { kind: 'personal'; userId: string }
  | { kind: 'team'; teamSlug: string }
  | { kind: 'global' };

export interface StatsQueryOpts {
  scope: StatsScope;
  format?: string | null; // filter to one format; omit/null = all formats
  minGames?: number; // min sample size to surface a row (global privacy floor)
}

export interface LeaderStat {
  leader: string;
  games: number;
  wins: number;
  decisive: number; // games with a winner signal (winRate denominator)
  winRate: number | null; // wins/decisive, null when no decisive games
}

export interface LeaderMatchup {
  leader: string;
  opponentLeader: string;
  games: number;
  wins: number;
  decisive: number;
  winRate: number | null;
}

// Compose the scope predicate over the matches⋈replays join. For global we also
// left-join users to honour the opt-out (anonymous uploads have no user to opt
// out, so they stay in). Returns the predicate; callers add their own filters.
function scopePredicate(scope: StatsScope) {
  if (scope.kind === 'personal') return eq(replays.userId, scope.userId);
  if (scope.kind === 'team') return eq(replayTeamShares.teamSlug, scope.teamSlug);
  // global: include anonymous uploads + signed-in users who haven't opted out.
  return or(isNull(replays.userId), eq(users.excludeFromGlobalStats, false));
}

const fmtCond = (format?: string | null) => (format ? eq(matchPlayers.format, format) : undefined);

// Attach the scope-specific join (team share / global opt-out) to a $dynamic
// match_players query builder. Shared by every aggregation so scoping can't
// drift between them.
function applyScopeJoins(q: any, scope: StatsScope) {
  if (scope.kind === 'team') return q.innerJoin(replayTeamShares, eq(replayTeamShares.replaySlug, matches.replaySlug));
  if (scope.kind === 'global') return q.leftJoin(users, eq(users.id, replays.userId));
  return q;
}

export async function getLeaderStats(opts: StatsQueryOpts): Promise<LeaderStat[]> {
  const minGames = opts.minGames ?? 1;
  const db = getDb();
  const base = db
    .select({
      leader: matchPlayers.leader,
      games: sql<number>`count(*)::int`,
      decisive: sql<number>`count(${matchPlayers.won})::int`,
      wins: sql<number>`count(*) filter (where ${matchPlayers.won})::int`,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.gameId, matchPlayers.gameId))
    .innerJoin(replays, eq(replays.slug, matches.replaySlug))
    .$dynamic();
  const rows = await applyScopeJoins(base, opts.scope)
    .where(and(isNotNull(matchPlayers.leader), fmtCond(opts.format), scopePredicate(opts.scope)))
    .groupBy(matchPlayers.leader)
    .having(sql`count(*) >= ${minGames}`)
    .orderBy(sql`count(*) desc`);
  return rows.map((r: any) => ({
    leader: r.leader as string,
    games: r.games,
    wins: r.wins,
    decisive: r.decisive,
    winRate: r.decisive > 0 ? r.wins / r.decisive : null,
  }));
}

export async function getLeaderMatchups(opts: StatsQueryOpts): Promise<LeaderMatchup[]> {
  const minGames = opts.minGames ?? 1;
  const db = getDb();
  const base = db
    .select({
      leader: matchPlayers.leader,
      opponentLeader: matchPlayers.opponentLeader,
      games: sql<number>`count(*)::int`,
      decisive: sql<number>`count(${matchPlayers.won})::int`,
      wins: sql<number>`count(*) filter (where ${matchPlayers.won})::int`,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.gameId, matchPlayers.gameId))
    .innerJoin(replays, eq(replays.slug, matches.replaySlug))
    .$dynamic();
  const rows = await applyScopeJoins(base, opts.scope)
    .where(and(isNotNull(matchPlayers.leader), isNotNull(matchPlayers.opponentLeader), fmtCond(opts.format), scopePredicate(opts.scope)))
    .groupBy(matchPlayers.leader, matchPlayers.opponentLeader)
    .having(sql`count(*) >= ${minGames}`)
    .orderBy(sql`count(*) desc`);
  return rows.map((r: any) => ({
    leader: r.leader as string,
    opponentLeader: r.opponentLeader as string,
    games: r.games,
    wins: r.wins,
    decisive: r.decisive,
    winRate: r.decisive > 0 ? r.wins / r.decisive : null,
  }));
}

export type CardEventKind = 'drawn' | 'resourced' | 'played' | 'discarded';

export interface CardStat {
  cardId: string;
  event: CardEventKind;
  observations: number; // (game, side) pairs where this card hit the event
  decisive: number; // …with a winner signal
  wins: number; // …where that side won
  winRate: number | null;
}

// "Win rate when card X was {event}". The unit is a (game, side) pair, NOT a
// raw event row — drawing 3 copies in one game is ONE observation, so we
// collapse to distinct (card, game, player) before aggregating. side_won is
// functionally determined by (game, player), so carrying it through the
// distinct doesn't change cardinality. Attribution lives on the rows
// (drawn/resourced = recorder-side; played/discarded = both) — callers pick the
// event knowing what it means; the UI labels it.
export async function getCardStats(opts: StatsQueryOpts & { event: CardEventKind }): Promise<CardStat[]> {
  const minGames = opts.minGames ?? 1;
  const db = getDb();
  const base = db
    .selectDistinct({
      cardId: cardEvents.cardId,
      gameId: cardEvents.gameId,
      playerId: cardEvents.playerId,
      sideWon: cardEvents.sideWon,
    })
    .from(cardEvents)
    .innerJoin(matches, eq(matches.gameId, cardEvents.gameId))
    .innerJoin(replays, eq(replays.slug, matches.replaySlug))
    .$dynamic();
  const sub = applyScopeJoins(base, opts.scope)
    .where(and(eq(cardEvents.event, opts.event), opts.format ? eq(cardEvents.format, opts.format) : undefined, scopePredicate(opts.scope)))
    .as('obs');
  const rows = await db
    .select({
      cardId: sub.cardId,
      observations: sql<number>`count(*)::int`,
      decisive: sql<number>`count(${sub.sideWon})::int`,
      wins: sql<number>`count(*) filter (where ${sub.sideWon})::int`,
    })
    .from(sub)
    .groupBy(sub.cardId)
    .having(sql`count(*) >= ${minGames}`)
    .orderBy(sql`count(*) desc`);
  return rows.map((r: any) => ({
    cardId: r.cardId as string,
    event: opts.event,
    observations: r.observations,
    decisive: r.decisive,
    wins: r.wins,
    winRate: r.decisive > 0 ? r.wins / r.decisive : null,
  }));
}
