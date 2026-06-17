// B101/P1 (ADR 0007): the scoping + aggregation layer. Reads the materialized
// fact tables (match_players / matches / card_events) and produces the numbers
// the /stats UI renders — over one of two audiences:
//
//   personal — the signed-in user's own replays
//   team     — a team's shared replays (via replay_team_shares)
//
// karabuddy is a team-internal testing tool: there is NO userbase-wide /
// community aggregate. Scope is a WHERE/JOIN over matches → replays (the
// uploader + shares), applied uniformly to every query here, so the two
// audiences can never leak into each other. Aggregation is plain SQL via the
// drizzle query builder (portable across neon / pg / pglite).

import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getDb } from './db';
import { matchPlayers, matches, replays, replayTeamShares, cardEvents, cards } from './schema';

export type StatsScope =
  | { kind: 'personal'; userId: string }
  // restrictSlugs (optional): further limit team stats to a subset of replays
  // — e.g. internal (teammate-vs-teammate) vs external games. Omitted = all of
  // the team's shared games. An empty array means "no matching games".
  | { kind: 'team'; teamSlug: string; restrictSlugs?: string[] };

export interface StatsQueryOpts {
  scope: StatsScope;
  format?: string | null; // filter to one format; omit/null = all formats
  minGames?: number; // min sample size to surface a row
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

// A "deck" = leader + base-IDENTITY, where base-identity collapses vanilla
// (no-ability) bases to their aspect but keeps ability bases (Tarkintown, the
// LAW splash bases, …) distinct — see cards.has_ability. So baseId is set ONLY
// for ability bases; vanilla decks carry baseAspect instead. Exactly one of the
// two is non-null for a normal row (both null = base unknown/unseeded).
export interface DeckStat {
  leader: string;
  baseId: string | null; // cardId, for ability bases
  baseAspect: string | null; // aspect, for vanilla bases
  games: number;
  wins: number;
  decisive: number;
  winRate: number | null;
}

export interface DeckMatchup {
  leader: string;
  baseId: string | null;
  baseAspect: string | null;
  opponentLeader: string;
  opponentBaseId: string | null;
  opponentBaseAspect: string | null;
  games: number;
  wins: number;
  decisive: number;
  winRate: number | null;
}

// SQL for the two base-identity columns given a `cards` alias joined on the
// base cardId: baseId is the cardId for ability bases (else null); baseAspect
// is the lowercased aspect for vanilla/unknown bases (else null). One non-null
// per row, so grouping on the pair partitions games into decks.
function baseIdentityCols(bc: ReturnType<typeof alias>) {
  return {
    baseId: sql<string | null>`case when ${(bc as any).hasAbility} then ${(bc as any).cardId} else null end`,
    baseAspect: sql<string | null>`case when ${(bc as any).hasAbility} then null else lower(${(bc as any).aspects}->>0) end`,
  };
}

// Compose the scope predicate over the matches⋈replays join. Returns the
// predicate; callers add their own filters. For team scope, an optional
// restrictSlugs narrows to a subset (internal vs external games) — an empty
// list means "no games" (always-false), not "all".
function scopePredicate(scope: StatsScope) {
  if (scope.kind === 'personal') return eq(replays.userId, scope.userId);
  const teamCond = eq(replayTeamShares.teamSlug, scope.teamSlug);
  if (scope.restrictSlugs === undefined) return teamCond;
  if (scope.restrictSlugs.length === 0) return sql`false`;
  return and(teamCond, inArray(replays.slug, scope.restrictSlugs));
}

const fmtCond = (format?: string | null) => (format ? eq(matchPlayers.format, format) : undefined);

// Attach the scope-specific join (team share) to a $dynamic match_players query
// builder. Shared by every aggregation so scoping can't drift between them.
function applyScopeJoins(q: any, scope: StatsScope) {
  if (scope.kind === 'team') return q.innerJoin(replayTeamShares, eq(replayTeamShares.replaySlug, matches.replaySlug));
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

// B101/Phase 3: per-game resourcing ratings for the trend (recorder rows that
// carry a rating, scoped + chronological). The headline efficiency is blended
// in the UI as Σwasted/Σavailable; each row also stands alone as a trend point.
// Each row carries its deck (leader + base-identity) so the UI can break the
// trend down by deck. personal/team only — resourcing is a first-person coaching
// stat over your own recorded games.
export interface ResourcingGame {
  gameId: string;
  replaySlug: string;
  createdAt: string;
  leader: string | null;
  baseId: string | null;
  baseAspect: string | null;
  available: number;
  wasted: number;
  forced: number;
  underspend: number;
  deadCards: number;
  countedRounds: number;
}

export async function getResourcingGames(opts: StatsQueryOpts & { limit?: number }): Promise<ResourcingGame[]> {
  const db = getDb();
  const bc = alias(cards, 'base_card');
  const idCols = baseIdentityCols(bc);
  const base = db
    .select({
      gameId: matchPlayers.gameId,
      replaySlug: matches.replaySlug,
      // replays.createdAt (upload time) is STABLE across a facts re-persist;
      // matches.createdAt resets on the delete+reinsert, so it can't order a trend.
      createdAt: replays.createdAt,
      leader: matchPlayers.leader,
      baseId: idCols.baseId,
      baseAspect: idCols.baseAspect,
      available: matchPlayers.resourceAvailable,
      wasted: matchPlayers.resourceWasted,
      forced: matchPlayers.resourceForced,
      underspend: matchPlayers.resourceUnderspend,
      deadCards: matchPlayers.resourceDeadCards,
      countedRounds: matchPlayers.resourceCountedRounds,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.gameId, matchPlayers.gameId))
    .innerJoin(replays, eq(replays.slug, matches.replaySlug))
    .leftJoin(bc, eq(bc.cardId, matchPlayers.base))
    .$dynamic();
  const rows = await applyScopeJoins(base, opts.scope)
    .where(and(eq(matchPlayers.isRecorder, true), isNotNull(matchPlayers.resourceAvailable), fmtCond(opts.format), scopePredicate(opts.scope)))
    .orderBy(sql`${replays.createdAt} desc`)
    .limit(opts.limit ?? 200);
  return rows.map((r: any) => ({
    gameId: r.gameId,
    replaySlug: r.replaySlug,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    leader: r.leader,
    baseId: r.baseId,
    baseAspect: r.baseAspect,
    available: r.available ?? 0,
    wasted: r.wasted ?? 0,
    forced: r.forced ?? 0,
    underspend: r.underspend ?? 0,
    deadCards: r.deadCards ?? 0,
    countedRounds: r.countedRounds ?? 0,
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
// `leader` / `baseAspect` scope card stats to a DECK context — i.e. only count
// events where the side that triggered them was playing that leader (and a base
// of that aspect). This is the "how does card X do in MY Krennic/Vigilance deck"
// view the teams actually want, scoped to your own / your team's recorded games.
export async function getCardStats(
  opts: StatsQueryOpts & { event: CardEventKind; leader?: string | null; baseAspect?: string | null; baseId?: string | null },
): Promise<CardStat[]> {
  const minGames = opts.minGames ?? 1;
  const db = getDb();
  let base = db
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
  const conds: any[] = [eq(cardEvents.event, opts.event), opts.format ? eq(cardEvents.format, opts.format) : undefined, scopePredicate(opts.scope)];
  if (opts.leader || opts.baseAspect || opts.baseId) {
    // Join the EVENT side's own match_players row (same game + player).
    base = base.innerJoin(matchPlayers, and(eq(matchPlayers.gameId, cardEvents.gameId), eq(matchPlayers.playerId, cardEvents.playerId)));
    if (opts.leader) conds.push(eq(matchPlayers.leader, opts.leader));
    if (opts.baseId) {
      // An ability base IS the deck — match the exact base card.
      conds.push(eq(matchPlayers.base, opts.baseId));
    } else if (opts.baseAspect) {
      // A vanilla deck = any no-ability base of this aspect (ability bases of
      // the same aspect are their own decks, so exclude them here).
      const baseCard = alias(cards, 'base_card');
      base = base.innerJoin(baseCard, eq(baseCard.cardId, matchPlayers.base));
      conds.push(sql`${baseCard.aspects} @> ${JSON.stringify([opts.baseAspect])}::jsonb`);
      conds.push(sql`coalesce(${baseCard.hasAbility}, false) = false`);
    }
  }
  const sub = applyScopeJoins(base, opts.scope).where(and(...conds)).as('obs');
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

// Distinct decks (leader + base-identity) played in scope, by games desc.
// Populates the Cards-view deck picker; `leader` narrows to one leader's decks.
export async function getDecks(opts: StatsQueryOpts & { leader?: string | null }): Promise<DeckStat[]> {
  const minGames = opts.minGames ?? 1;
  const db = getDb();
  const bc = alias(cards, 'base_card');
  const idCols = baseIdentityCols(bc);
  const base = db
    .select({
      leader: matchPlayers.leader,
      baseId: idCols.baseId,
      baseAspect: idCols.baseAspect,
      games: sql<number>`count(*)::int`,
      decisive: sql<number>`count(${matchPlayers.won})::int`,
      wins: sql<number>`count(*) filter (where ${matchPlayers.won})::int`,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.gameId, matchPlayers.gameId))
    .innerJoin(replays, eq(replays.slug, matches.replaySlug))
    .leftJoin(bc, eq(bc.cardId, matchPlayers.base))
    .$dynamic();
  const rows = await applyScopeJoins(base, opts.scope)
    .where(and(isNotNull(matchPlayers.leader), opts.leader ? eq(matchPlayers.leader, opts.leader) : undefined, fmtCond(opts.format), scopePredicate(opts.scope)))
    .groupBy(matchPlayers.leader, idCols.baseId, idCols.baseAspect)
    .having(sql`count(*) >= ${minGames}`)
    .orderBy(sql`count(*) desc`);
  return rows.map((r: any) => ({
    leader: r.leader, baseId: r.baseId, baseAspect: r.baseAspect,
    games: r.games, wins: r.wins, decisive: r.decisive,
    winRate: r.decisive > 0 ? r.wins / r.decisive : null,
  }));
}

// Deck-vs-deck matchups (the "Leaders & Bases" heatmap lens): like
// getLeaderMatchups but both axes carry a base-identity, so e.g. "Boba /
// Tarkintown vs Lando / Cunning" is its own row.
export async function getDeckMatchups(opts: StatsQueryOpts): Promise<DeckMatchup[]> {
  const minGames = opts.minGames ?? 1;
  const db = getDb();
  const sbc = alias(cards, 'self_base');
  const obc = alias(cards, 'opp_base');
  const self = baseIdentityCols(sbc);
  const opp = baseIdentityCols(obc);
  const base = db
    .select({
      leader: matchPlayers.leader,
      baseId: self.baseId,
      baseAspect: self.baseAspect,
      opponentLeader: matchPlayers.opponentLeader,
      opponentBaseId: opp.baseId,
      opponentBaseAspect: opp.baseAspect,
      games: sql<number>`count(*)::int`,
      decisive: sql<number>`count(${matchPlayers.won})::int`,
      wins: sql<number>`count(*) filter (where ${matchPlayers.won})::int`,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.gameId, matchPlayers.gameId))
    .innerJoin(replays, eq(replays.slug, matches.replaySlug))
    .leftJoin(sbc, eq(sbc.cardId, matchPlayers.base))
    .leftJoin(obc, eq(obc.cardId, matchPlayers.opponentBase))
    .$dynamic();
  const rows = await applyScopeJoins(base, opts.scope)
    .where(and(isNotNull(matchPlayers.leader), isNotNull(matchPlayers.opponentLeader), fmtCond(opts.format), scopePredicate(opts.scope)))
    .groupBy(matchPlayers.leader, self.baseId, self.baseAspect, matchPlayers.opponentLeader, opp.baseId, opp.baseAspect)
    .having(sql`count(*) >= ${minGames}`)
    .orderBy(sql`count(*) desc`);
  return rows.map((r: any) => ({
    leader: r.leader, baseId: r.baseId, baseAspect: r.baseAspect,
    opponentLeader: r.opponentLeader, opponentBaseId: r.opponentBaseId, opponentBaseAspect: r.opponentBaseAspect,
    games: r.games, wins: r.wins, decisive: r.decisive,
    winRate: r.decisive > 0 ? r.wins / r.decisive : null,
  }));
}
