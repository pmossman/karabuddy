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

import { and, eq, exists, inArray, isNotNull, isNull, notExists, or, sql, gte, lte } from 'drizzle-orm';
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { getDb } from './db';
import { matchPlayers, matches, replays, cards, teamMembers, replayTeamShares } from './schema';

export type StatsScope =
  | { kind: 'personal'; userId: string }
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
  // Time window over matches.createdAt (lib/dateRange grammar parsed at the
  // API edge — these are the resolved bounds). Null/omit = all time.
  from?: Date | null;
  to?: Date | null;
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
// LAW splash bases, …) distinct — see cards.has_ability. So baseId is set for
// ability bases AND for bases the catalog doesn't know yet (a new set before
// it's seeded: unknown ability → its own deck, never merged); vanilla decks
// carry baseAspect instead. Exactly one of the two is non-null for a row with a
// base (both null = no base recorded).
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

// SQL for the two base-identity columns, given the base column (`baseCol`) and a
// `cards` alias LEFT-joined on it. Only a base the catalog KNOWS has no ability
// (has_ability = false) collapses to its aspect; an ability base, or one with no
// catalog row / unknown ability (unseeded set), is its own deck, keyed by the
// base column itself (the catalog row may not exist). One non-null per row, so
// grouping on the pair partitions games into decks. `applySelfBaseFilter` is the
// inverse — keep the two in lockstep so every deck row round-trips as a filter.
function baseIdentityCols(bc: ReturnType<typeof alias>, baseCol: AnyPgColumn) {
  const hasAbility = (bc as any).hasAbility;
  return {
    baseId: sql<string | null>`case when coalesce(${hasAbility}, true) then ${baseCol} else null end`,
    baseAspect: sql<string | null>`case when ${hasAbility} = false then lower(${(bc as any).aspects}->>0) else null end`,
  };
}

// B233: stats are SEAT-based, in BOTH scopes. A match_players row (one seat of a
// game) belongs to whoever holds a replay of that game RECORDED FROM that seat —
// replays.ownerPlayerId = the seat. Personal = a replay of yours; team = a replay
// of a team member's.
//
// Why: `matches` is one row per gameId carrying ONE replaySlug (upserted per
// upload in lib/statsPersist, so last writer wins). But `replays` is deliberately
// one row PER RECORDER (B158) — both players who record the same karabast game
// keep their own. Anything keyed on "the persisted replay" or on
// match_players.isRecorder therefore depends on who uploaded last:
//   - personal used (replays.slug = matches.replaySlug) + isRecorder, so a game
//     whose opponent persisted last silently left your stats;
//   - team used isRecorder alone, assuming "the recorder row is always a member".
//     That stopped holding when isRecorder became sticky per seat (B237, then the
//     race fix): on an EXTERNAL game co-recorded by an outsider who also runs
//     KaraBuddy, BOTH seats are recorded, so the outsider's leader counted as a
//     team play.
// The seat owner's replay row is independent of upload order, so each recorder
// gets exactly their own side, and a team gets exactly its members' sides.
//
// isRecorder still means "some upload was recorded from this seat" — it says the
// seat's card facts / resourcing rating are first-person (lib/statsPersist) — but
// it is NOT an ownership signal and no scope keys on it, except:
//
// Legacy fallback: pre-B59 and anonymous-claimed replays carry a null
// ownerPlayerId and can't be seat-matched. Such a replay owns the seat its upload
// was persisted as (replays.slug = matches.replaySlug + isRecorder) — but only if
// no OTHER replay of the game claims that seat by ownerPlayerId, since with sticky
// isRecorder the persisted slug no longer singles out one recorded seat. So the
// fallback only ever adds a seat nobody else owns; it can't hand you someone
// else's.
function seatOwnedBy(sr: any, playerIdCol: AnyPgColumn) {
  const claim = alias(replays, 'seat_claim');
  return or(
    eq(sr.ownerPlayerId, playerIdCol),
    and(
      isNull(sr.ownerPlayerId),
      eq(sr.slug, matches.replaySlug),
      eq(matchPlayers.isRecorder, true),
      notExists(
        getDb()
          .select({ one: sql`1` })
          .from(claim)
          .where(and(eq(claim.gameId, sr.gameId), eq(claim.ownerPlayerId, playerIdCol))),
      ),
    ),
  );
}

// "This seat is the signed-in user's" — a replay of theirs owns it.
function personalSeatCond(userId: string) {
  const sr = alias(replays, 'seat_replay');
  return exists(
    getDb()
      .select({ one: sql`1` })
      .from(sr)
      .where(and(eq(sr.userId, userId), eq(sr.gameId, matchPlayers.gameId), seatOwnedBy(sr, matchPlayers.playerId))),
  );
}

// "This seat is a team member's" — a replay recorded by a member owns it.
function teamSeatCond(teamSlug: string) {
  const sr = alias(replays, 'team_seat_replay');
  const tm = alias(teamMembers, 'team_seat_member');
  return exists(
    getDb()
      .select({ one: sql`1` })
      .from(sr)
      .innerJoin(tm, and(eq(tm.userId, sr.userId), eq(tm.teamSlug, teamSlug)))
      .where(and(eq(sr.gameId, matchPlayers.gameId), seatOwnedBy(sr, matchPlayers.playerId))),
  );
}

// Compose the scope predicate. Personal = your own seat in your own uploads
// (see personalSeatCond). Team = the precomputed eligible-gameId set (team-member
// recorded + shared), filtered by GAMEID so a co-recorded game counts no matter
// which sibling was persisted last — an empty set means "no games" (always-false).
// Which SEATS of those games count for a team is perspectiveCond's job.
function scopePredicate(scope: StatsScope) {
  if (scope.kind === 'personal') return personalSeatCond(scope.userId);
  if (scope.restrictGameIds.length === 0) return sql`false`;
  return inArray(matches.gameId, scope.restrictGameIds);
}

// Which match_players rows count, by audience.
//
// Personal needs nothing here: scopePredicate already pins the row to YOUR seat,
// so a game you recorded counts your leader, not your opponent's.
//
// Team = a team MEMBER's plays, never an outsider's: the seat must be owned by a
// member's replay (teamSeatCond). Both sides of an INTERNAL game (≥2 member
// recorders, lib/teamSurface.teamGameIds) count — the matrix shows both
// teammates — and that stays an explicit OR so an internal game with a legacy
// null-owner sibling keeps both rows. For an EXTERNAL game only the member's seat
// counts, whoever uploaded last and whether or not the outsider recorded too.
const perspectiveCond = (scope: StatsScope) =>
  scope.kind === 'personal'
    ? undefined
    : scope.internalGameIds.length
      ? or(teamSeatCond(scope.teamSlug), inArray(matches.gameId, scope.internalGameIds))
      : teamSeatCond(scope.teamSlug);

// The replay row a stats row should be PRESENTED as, for the two producers that
// return replay fields (resourcing trend, drill-in lists): the replay that owns
// the row's seat (seatOwnedBy), so it's shown from that player's point of view —
// personal = your own sibling, team = the member's own sibling. The join doubles
// as the "my side only" filter: a seat no replay in the set owns joins nothing.
//
// A user can hold two replay rows for the same game+seat — the upload route
// dedupes per (gameId, ownerToken), so recording the same game from a second
// browser/install mints a second row (98 such pairs in prod at time of writing).
// distinct-on collapses them to one, so the seat join can't fan out and
// double-count. For a team, the sibling shared WITH the team wins (a teammate
// can open it), then the earliest.
const replayCols = {
  slug: replays.slug,
  gameId: replays.gameId,
  ownerPlayerId: replays.ownerPlayerId,
  createdAt: replays.createdAt,
  players: replays.players,
  winners: replays.winners,
  displayName: replays.displayName,
};

function myReplaysFor(userId: string) {
  return getDb()
    .selectDistinctOn([replays.gameId, replays.ownerPlayerId], replayCols)
    .from(replays)
    .where(eq(replays.userId, userId))
    .orderBy(replays.gameId, replays.ownerPlayerId, replays.createdAt)
    .as('my_replay');
}

function teamReplaysFor(teamSlug: string) {
  return getDb()
    .selectDistinctOn([replays.gameId, replays.ownerPlayerId], replayCols)
    .from(replays)
    .innerJoin(teamMembers, and(eq(teamMembers.userId, replays.userId), eq(teamMembers.teamSlug, teamSlug)))
    .leftJoin(replayTeamShares, and(eq(replayTeamShares.replaySlug, replays.slug), eq(replayTeamShares.teamSlug, teamSlug)))
    .orderBy(replays.gameId, replays.ownerPlayerId, sql`${replayTeamShares.replaySlug} is null`, replays.createdAt)
    .as('team_replay');
}

function scopedReplaySource(scope: StatsScope): { rt: any; on: any } {
  const rt = (scope.kind === 'personal' ? myReplaysFor(scope.userId) : teamReplaysFor(scope.teamSlug)) as any;
  return { rt, on: and(eq(rt.gameId, matchPlayers.gameId), seatOwnedBy(rt, matchPlayers.playerId)) };
}

const fmtCond = (format?: string | null) => (format ? eq(matchPlayers.format, format) : undefined);
// Time window over matches.createdAt — every stats query joins matches.
const timeCond = (opts: { from?: Date | null; to?: Date | null }) =>
  and(
    opts.from ? gte(matches.createdAt, opts.from) : undefined,
    opts.to ? lte(matches.createdAt, opts.to) : undefined,
  );

// Self-side deck filter shared by the leader-scoped producers (drill-in, card
// stats) — the inverse of baseIdentityCols: exact base for a `baseId` deck (an
// ability base, or one the catalog doesn't know yet), or any KNOWN no-ability
// base of an aspect (`baseAspect`; ability and unseeded bases are their own
// decks). Pushes its WHERE conditions into `conds` and returns the (possibly
// base-card-joined) dynamic builder.
function applySelfBaseFilter(qb: any, opts: { baseId?: string | null; baseAspect?: string | null }, conds: any[]): any {
  if (opts.baseId) {
    conds.push(eq(matchPlayers.base, opts.baseId));
  } else if (opts.baseAspect) {
    const bc = alias(cards, 'self_base');
    qb = qb.innerJoin(bc, eq(bc.cardId, matchPlayers.base));
    conds.push(sql`${(bc as any).aspects} @> ${JSON.stringify([opts.baseAspect])}::jsonb`);
    conds.push(sql`${(bc as any).hasAbility} = false`);
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
    .$dynamic();
  const rows = await base
    .where(and(isNotNull(matchPlayers.leader), perspectiveCond(opts.scope), fmtCond(opts.format), timeCond(opts), scopePredicate(opts.scope)))
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
    .$dynamic();
  const conds: any[] = [isNotNull(matchPlayers.leader), isNotNull(matchPlayers.opponentLeader), perspectiveCond(opts.scope), fmtCond(opts.format), timeCond(opts), scopePredicate(opts.scope)];
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
  const idCols = baseIdentityCols(bc, matchPlayers.base);
  // Presents the seat owner's sibling: yours, or the member's (B233).
  const { rt, on } = scopedReplaySource(opts.scope);
  const base = db
    .select({
      gameId: matchPlayers.gameId,
      replaySlug: rt.slug,
      // the replay's createdAt (upload time) — the trend's order. (matches.createdAt
      // used to reset on every re-persist; it's stable now, but this stays per-replay.)
      createdAt: rt.createdAt,
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
    .innerJoin(rt, on)
    .leftJoin(bc, eq(bc.cardId, matchPlayers.base))
    .$dynamic();
  // The seat join IS the my-side filter in both scopes (a member's own seat for a
  // team — resourcing is first-person); team also narrows to its eligible games.
  const scopeConds = opts.scope.kind === 'personal' ? [] : [scopePredicate(opts.scope)];
  const rows = await base
    .where(and(...scopeConds, isNotNull(matchPlayers.resourceAvailable), fmtCond(opts.format), timeCond(opts)))
    .orderBy(sql`${rt.createdAt} desc`)
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

// B194 drill-in: the recent replays on a given leader (and optionally a deck).
// "My side only" — seats in scope (yours / a member's) where matchPlayers.leader =
// the focus leader, so it lists games where YOU played that leader (not games you
// faced it). Returns the replay fields the viewer cards need + that seat's result,
// newest first by the seat owner's replays.createdAt.
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
  // Lists the seat owner's OWN replay row (seat-matched): yours for personal, the
  // member's for a team — so a co-recorded game links to that player's capture
  // whoever's upload was persisted last (B233).
  const { rt, on } = scopedReplaySource(opts.scope);
  let base = db
    .select({
      gameId: matchPlayers.gameId,
      slug: rt.slug,
      createdAt: rt.createdAt,
      players: rt.players,
      winners: rt.winners,
      ownerPlayerId: rt.ownerPlayerId,
      displayName: rt.displayName,
      won: matchPlayers.won,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.gameId, matchPlayers.gameId))
    .innerJoin(rt, on)
    .$dynamic();
  // My side only — a "replays on leader X" list means games WE played X. The seat
  // join gives that in both scopes (a member's own seat for a team); team also
  // narrows to its eligible games.
  const conds: any[] =
    opts.scope.kind === 'personal'
      ? [fmtCond(opts.format), timeCond(opts)]
      : [fmtCond(opts.format), timeCond(opts), scopePredicate(opts.scope)];
  if (opts.leader) conds.push(eq(matchPlayers.leader, opts.leader));
  if (opts.opponentLeader) conds.push(eq(matchPlayers.opponentLeader, opts.opponentLeader));
  base = applySelfBaseFilter(base, opts, conds);
  const rows = await base
    .where(and(...conds))
    .orderBy(sql`${rt.createdAt} desc`)
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
  // B235: card facts live on the side's own match_players row as
  // card_events->{event}->{cardId} = first frame. One observation per
  // (game, side, card) by construction, so the audience boundary is exactly the
  // one every other producer uses (scopePredicate + perspectiveCond) — played/
  // discarded exist on BOTH sides' rows, drawn/resourced only on the recorder's.
  const ce = sql`jsonb_object_keys(coalesce(${matchPlayers.cardEvents} -> ${opts.event}, '{}'::jsonb))`;
  let base = db
    .select({
      cardId: sql<string>`ce.card_id`.as('card_id'),
      sideWon: matchPlayers.won,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.gameId, matchPlayers.gameId))
    .crossJoinLateral(sql`${ce} as ce(card_id)`)
    .$dynamic();
  const conds: any[] = [opts.format ? eq(matches.format, opts.format) : undefined, timeCond(opts), perspectiveCond(opts.scope), scopePredicate(opts.scope)];
  if (opts.leader) conds.push(eq(matchPlayers.leader, opts.leader));
  if (opts.opponentLeader) conds.push(eq(matchPlayers.opponentLeader, opts.opponentLeader));
  base = applySelfBaseFilter(base, opts, conds);
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
  const idCols = baseIdentityCols(bc, matchPlayers.base);
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
    .leftJoin(bc, eq(bc.cardId, matchPlayers.base))
    .$dynamic();
  const rows = await base
    .where(and(isNotNull(matchPlayers.leader), opts.leader ? eq(matchPlayers.leader, opts.leader) : undefined, perspectiveCond(opts.scope), fmtCond(opts.format), timeCond(opts), scopePredicate(opts.scope)))
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
  const self = baseIdentityCols(sbc, matchPlayers.base);
  const opp = baseIdentityCols(obc, matchPlayers.opponentBase);
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
    .leftJoin(sbc, eq(sbc.cardId, matchPlayers.base))
    .leftJoin(obc, eq(obc.cardId, matchPlayers.opponentBase))
    .$dynamic();
  const rows = await base
    .where(and(isNotNull(matchPlayers.leader), isNotNull(matchPlayers.opponentLeader), perspectiveCond(opts.scope), fmtCond(opts.format), timeCond(opts), scopePredicate(opts.scope)))
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
