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

import { and, eq, inArray, isNull, isNotNull, notInArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getDb } from './db';
import { matchPlayers, matches, replays, cardEvents, cards } from './schema';

export type StatsScope =
  | { kind: 'personal'; userId: string }
  // global: the WHOLE meta — every recorder's side across all uploads, minus
  // users who opted out of global stats (users.exclude_from_global_stats).
  // Encrypted (private-team) replays never produce facts, so they're already
  // absent. Admin-gated at the route today; built to be public-safe (aggregate-
  // only — the route refuses per-replay drill-in for this scope).
  | { kind: 'global'; excludedUserIds: string[] }
  // restrictGameIds: the team's eligible GAMEIDS for this view (team-member
  // recorded + ≥1 sibling shared with the team), already split internal /
  // external / all by the caller via teamGameIds. Filtering by gameId — not a
  // representative replay slug — is what makes co-recorded games count
  // regardless of which sibling was persisted last. Empty = "no matching games".
  // internalGameIds: the subset that is teammate-vs-teammate (≥2 member recorders).
  // The opponent's match_players row counts ONLY for these — for an EXTERNAL game
  // the "opponent" is an outsider and must not enter the team's stats.
  | { kind: 'team'; teamSlug: string; restrictGameIds: string[]; internalGameIds: string[] };

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

// Compose the scope predicate. Personal = the user's own uploads. Team = the
// precomputed eligible-gameId set (team-member recorded + shared), filtered by
// GAMEID so a co-recorded game counts no matter which sibling was persisted last
// — an empty set means "no games" (always-false).
function scopePredicate(scope: StatsScope) {
  if (scope.kind === 'personal') return eq(replays.userId, scope.userId);
  if (scope.kind === 'global') {
    // All uploads, minus opted-out users. Anonymous uploads (null userId) have
    // no account to opt out → kept. (`x NOT IN (...)` is null on null x, so the
    // explicit isNull is required to include them.)
    return scope.excludedUserIds.length
      ? or(isNull(replays.userId), notInArray(replays.userId, scope.excludedUserIds))
      : sql`true`;
  }
  if (scope.restrictGameIds.length === 0) return sql`false`;
  return inArray(matches.gameId, scope.restrictGameIds);
}

// Which match_players rows count, by audience. Personal = YOUR side only (the
// recorder row), so a game you recorded counts your leader, not your opponent's.
//
// Team = a team MEMBER's plays, never an outsider's. The recorder row is always a
// member (the uploader); the opponent row counts ONLY for INTERNAL games, where
// that "opponent" is another teammate — so the matrix still shows both sides of an
// internal game. For an EXTERNAL game the opponent is an outsider and is dropped —
// this is the fix for team stats counting the opponent's leader as one you played.
const perspectiveCond = (scope: StatsScope) =>
  // Global = the META: count BOTH sides of every game (match_players has one row
  // per side). Each side is a real data point, so cell(A,B) and cell(B,A) are
  // computed over the SAME games and stay complementary — the matrix is
  // symmetric. (Counting only the recorder's side made (A,B)/(B,A) draw from
  // different games — whichever player uploaded — so they didn't add to 100%.)
  scope.kind === 'global'
    ? undefined
    : scope.kind === 'personal'
    ? eq(matchPlayers.isRecorder, true)
    : scope.internalGameIds.length
      ? or(eq(matchPlayers.isRecorder, true), inArray(matches.gameId, scope.internalGameIds))
      : eq(matchPlayers.isRecorder, true);

const fmtCond = (format?: string | null) => (format ? eq(matchPlayers.format, format) : undefined);

// Self-side deck filter shared by leader-scoped producers (drill-in): exact base
// for an ability base (`baseId`), or any vanilla base of an aspect (`baseAspect`,
// excluding ability bases — they're their own decks). Pushes its WHERE conditions
// into `conds` and returns the (possibly base-card-joined) dynamic builder.
function applySelfBaseFilter(qb: any, opts: { baseId?: string | null; baseAspect?: string | null }, conds: any[]): any {
  if (opts.baseId) {
    conds.push(eq(matchPlayers.base, opts.baseId));
  } else if (opts.baseAspect) {
    const bc = alias(cards, 'self_base');
    qb = qb.innerJoin(bc, eq(bc.cardId, matchPlayers.base));
    conds.push(sql`${(bc as any).aspects} @> ${JSON.stringify([opts.baseAspect])}::jsonb`);
    conds.push(sql`coalesce(${(bc as any).hasAbility}, false) = false`);
  }
  return qb;
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
  const rows = await base
    .where(and(isNotNull(matchPlayers.leader), perspectiveCond(opts.scope), fmtCond(opts.format), scopePredicate(opts.scope)))
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

// `leader`/`baseId`/`baseAspect` scope the SELF side to one leader (and optionally
// one deck) — the drill-in's "this leader's record vs each opponent". Omit them
// and it returns the full directed matrix as before.
export async function getLeaderMatchups(opts: StatsQueryOpts & { leader?: string | null; baseId?: string | null; baseAspect?: string | null }): Promise<LeaderMatchup[]> {
  const minGames = opts.minGames ?? 1;
  const db = getDb();
  let base = db
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
  const conds: any[] = [isNotNull(matchPlayers.leader), isNotNull(matchPlayers.opponentLeader), perspectiveCond(opts.scope), fmtCond(opts.format), scopePredicate(opts.scope)];
  if (opts.leader) conds.push(eq(matchPlayers.leader, opts.leader));
  base = applySelfBaseFilter(base, opts, conds);
  const rows = await base
    .where(and(...conds))
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
  const rows = await base
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

// B194 drill-in: the recorder's recent replays on a given leader (and optionally a
// deck). "My side only" — `isRecorder` rows where matchPlayers.leader = the focus
// leader, so it lists games where YOU played that leader (not games you faced it).
// Returns the replay fields the viewer cards need + the recorder's result, newest
// first by the STABLE replays.createdAt (matches.createdAt resets on re-persist).
export interface EntityReplay {
  gameId: string;
  slug: string;
  createdAt: string;
  players: unknown;
  winners: string[] | null;
  ownerPlayerId: string | null;
  displayName: string | null;
  won: boolean | null;
}

export async function getEntityReplays(
  opts: StatsQueryOpts & { leader?: string | null; baseId?: string | null; baseAspect?: string | null; opponentLeader?: string | null; limit?: number },
): Promise<EntityReplay[]> {
  const db = getDb();
  let base = db
    .select({
      gameId: matchPlayers.gameId,
      slug: replays.slug,
      createdAt: replays.createdAt,
      players: replays.players,
      winners: replays.winners,
      ownerPlayerId: replays.ownerPlayerId,
      displayName: replays.displayName,
      won: matchPlayers.won,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.gameId, matchPlayers.gameId))
    .innerJoin(replays, eq(replays.slug, matches.replaySlug))
    .$dynamic();
  // My side only (recorder) — independent of perspectiveCond (which, for team,
  // also counts opponent rows): a "replays on leader X" list means games I played X.
  const conds: any[] = [eq(matchPlayers.isRecorder, true), fmtCond(opts.format), scopePredicate(opts.scope)];
  if (opts.leader) conds.push(eq(matchPlayers.leader, opts.leader));
  if (opts.opponentLeader) conds.push(eq(matchPlayers.opponentLeader, opts.opponentLeader));
  base = applySelfBaseFilter(base, opts, conds);
  const rows = await base
    .where(and(...conds))
    .orderBy(sql`${replays.createdAt} desc`)
    .limit(opts.limit ?? 50);
  return rows.map((r: any) => ({
    gameId: r.gameId,
    slug: r.slug,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    players: r.players,
    winners: Array.isArray(r.winners) ? r.winners : null,
    ownerPlayerId: r.ownerPlayerId ?? null,
    displayName: r.displayName ?? null,
    won: r.won,
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
  opts: StatsQueryOpts & { event: CardEventKind; leader?: string | null; baseAspect?: string | null; baseId?: string | null; opponentLeader?: string | null },
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
  if (opts.leader || opts.baseAspect || opts.baseId || opts.opponentLeader) {
    // Join the EVENT side's own match_players row (same game + player).
    base = base.innerJoin(matchPlayers, and(eq(matchPlayers.gameId, cardEvents.gameId), eq(matchPlayers.playerId, cardEvents.playerId)));
    if (opts.leader) conds.push(eq(matchPlayers.leader, opts.leader));
    if (opts.opponentLeader) conds.push(eq(matchPlayers.opponentLeader, opts.opponentLeader));
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
  const sub = base.where(and(...conds)).as('obs');
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
  const rows = await base
    .where(and(isNotNull(matchPlayers.leader), opts.leader ? eq(matchPlayers.leader, opts.leader) : undefined, perspectiveCond(opts.scope), fmtCond(opts.format), scopePredicate(opts.scope)))
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
  const rows = await base
    .where(and(isNotNull(matchPlayers.leader), isNotNull(matchPlayers.opponentLeader), perspectiveCond(opts.scope), fmtCond(opts.format), scopePredicate(opts.scope)))
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
