// B231: Sideboard Guides — team-shared, matchup-scoped "cards good (IN) / bad
// (OUT) in this matchup" + notes. This module owns the data: the frequency-
// sorted card POOL (aggregated from the team's decklists for an archetype), the
// guide CRUD (author-owned, team-visible), and the matchup options that feed
// the authoring selectors.

import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNotNull, desc } from 'drizzle-orm';
import { getDb } from './db';
import { replays, replayTeamShares, teamMembers, sideboardTakes, sideboardMatchupComments, cards, users } from './schema';
import { resolveBaseIdentities, type BaseIdentity } from './baseIdentity';

export interface PoolCard {
  cardId: string;
  name: string | null;
  subtitle: string | null;
  set: string | null;
  number: number | null;
  cost: number | null;
  type: string | null;
  aspects: string[] | null;
  count: number; // number of the team's decklists (for this archetype) that include it
  fraction: number; // count / totalLists — the "in N% of lists" staple signal
}

export async function isTeamMember(teamSlug: string, userId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamSlug, teamSlug), eq(teamMembers.userId, userId)))
    .limit(1);
  return !!row;
}

// The candidate card pool for authoring a guide: every card the TEAM has run in
// this archetype (own leader [+ base]), across all shared replays, frequency-
// sorted so staples surface above tech/test one-offs. Aggregates the recorder's
// full deck + sideboard from each matching replay's decklist.
export async function matchupCardPool(
  teamSlug: string,
  ownLeaderName: string,
  ownBaseName?: string | null,
): Promise<{ totalLists: number; cards: PoolCard[] }> {
  const db = getDb();
  const rows = await db
    .select({ ownerPlayerId: replays.ownerPlayerId, players: replays.players, decks: replays.decks })
    .from(replays)
    .innerJoin(replayTeamShares, eq(replayTeamShares.replaySlug, replays.slug))
    .where(and(eq(replayTeamShares.teamSlug, teamSlug), isNotNull(replays.decks)));

  const freq = new Map<string, number>();
  let totalLists = 0;
  for (const r of rows) {
    const opid = r.ownerPlayerId;
    if (!opid) continue;
    const players = Array.isArray(r.players) ? (r.players as any[]) : [];
    const me = players.find((p) => p?.id === opid);
    if (!me || me.leader?.name !== ownLeaderName) continue;
    if (ownBaseName && me.base?.name !== ownBaseName) continue;
    const d = (r.decks as any)?.[opid];
    if (!d) continue;
    // Count each card once per list (presence, not copies) — staple frequency.
    const ids = new Set<string>();
    for (const c of [...(d.deck || []), ...(d.sideboard || [])]) if (c?.id) ids.add(c.id);
    if (ids.size === 0) continue;
    totalLists++;
    for (const id of ids) freq.set(id, (freq.get(id) || 0) + 1);
  }
  if (freq.size === 0) return { totalLists: 0, cards: [] };

  const meta = await db.select().from(cards).where(inArray(cards.cardId, [...freq.keys()]));
  const metaById = new Map(meta.map((m) => [m.cardId, m]));
  const list: PoolCard[] = [...freq.entries()].map(([cardId, count]) => {
    const m = metaById.get(cardId);
    return {
      cardId,
      name: m?.name ?? null,
      subtitle: m?.subtitle ?? null,
      set: m?.set ?? null,
      number: m?.number ?? null,
      cost: m?.cost ?? null,
      type: m?.type ?? null,
      aspects: m?.aspects ?? null,
      count,
      fraction: count / totalLists,
    };
  });
  // Staples first; ties broken by cost then name for a stable, scannable order.
  list.sort((a, b) => b.count - a.count || (a.cost ?? 99) - (b.cost ?? 99) || (a.name ?? '').localeCompare(b.name ?? ''));
  return { totalLists, cards: list };
}

export interface LeaderOption { name: string; set: string | null; number: number | null }
export interface MatchupOptions {
  ownLeaders: LeaderOption[]; oppLeaders: LeaderOption[];
  // Bases use the ONE base identity system (lib/baseIdentity): vanilla bases
  // collapse to their aspect (rendered as the aspect icon, no name), unique
  // bases stay themselves (own art + name). Keyed by functional identity.
  ownBaseKinds: BaseIdentity[]; oppBaseKinds: BaseIdentity[];
}
// The team's played leaders (by name) + base functional KINDS, split by side,
// for the authoring matchup selectors. Own = the recorder's; opp = the other.
export async function teamMatchupOptions(teamSlug: string): Promise<MatchupOptions> {
  const rows = await getDb()
    .select({ ownerPlayerId: replays.ownerPlayerId, players: replays.players })
    .from(replays)
    .innerJoin(replayTeamShares, eq(replayTeamShares.replaySlug, replays.slug))
    .where(eq(replayTeamShares.teamSlug, teamSlug));

  const ownLeaders = new Map<string, LeaderOption>(), oppLeaders = new Map<string, LeaderOption>();
  const ownBaseRefs: any[] = [], oppBaseRefs: any[] = [];
  const addLeader = (m: Map<string, LeaderOption>, c: any) => { if (c?.name && !m.has(c.name)) m.set(c.name, { name: c.name, set: c.set ?? null, number: c.number ?? null }); };
  for (const r of rows) {
    for (const p of (Array.isArray(r.players) ? (r.players as any[]) : [])) {
      const own = p?.id === r.ownerPlayerId;
      addLeader(own ? ownLeaders : oppLeaders, p?.leader);
      if (p?.base) (own ? ownBaseRefs : oppBaseRefs).push(p.base);
    }
  }
  const [ownIds, oppIds] = await Promise.all([resolveBaseIdentities(ownBaseRefs), resolveBaseIdentities(oppBaseRefs)]);
  const distinctKinds = (ids: Map<string, BaseIdentity>) => {
    const byKey = new Map<string, BaseIdentity>();
    for (const k of ids.values()) if (!byKey.has(k.key)) byKey.set(k.key, k);
    return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
  };
  const sortLeaders = (m: Map<string, LeaderOption>) => [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { ownLeaders: sortLeaders(ownLeaders), oppLeaders: sortLeaders(oppLeaders), ownBaseKinds: distinctKinds(ownIds), oppBaseKinds: distinctKinds(oppIds) };
}

// Leader NAME -> art (leaders only; bases render from their kind, not name art).
export function leaderArtFromMatchups(m: MatchupOptions): Record<string, { set: string | null; number: number | null }> {
  const map: Record<string, { set: string | null; number: number | null }> = {};
  for (const list of [m.ownLeaders, m.oppLeaders]) for (const o of list) if (!map[o.name]) map[o.name] = { set: o.set, number: o.number };
  return map;
}
// Base functional-identity KEY -> its kind, for rendering a stored base.
export function baseKindsByKey(m: MatchupOptions): Record<string, BaseIdentity> {
  const map: Record<string, BaseIdentity> = {};
  for (const list of [m.ownBaseKinds, m.oppBaseKinds]) for (const k of list) if (!map[k.key]) map[k.key] = k;
  return map;
}
// Everything the client needs to RENDER a guide's matchup — leader art + the
// base-kind lookup keyed by the stored base key. One team-replay scan.
export async function matchupContextForTeam(teamSlug: string): Promise<{ leaderArt: Record<string, { set: string | null; number: number | null }>; baseKinds: Record<string, BaseIdentity> }> {
  const m = await teamMatchupOptions(teamSlug);
  return { leaderArt: leaderArtFromMatchups(m), baseKinds: baseKindsByKey(m) };
}

// ── Guide CRUD ────────────────────────────────────────────────────────────

export interface GuideCard { cardId: string; note?: string | null }

// Clamp untrusted IN/OUT card lists from the client to the stored shape.
export function sanitizeGuideCards(arr: unknown): GuideCard[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((c): c is { cardId: string; note?: unknown } => !!c && typeof (c as any).cardId === 'string' && (c as any).cardId.trim().length > 0)
    .map((c) => ({ cardId: c.cardId.trim(), note: typeof c.note === 'string' && c.note.trim() ? c.note.trim().slice(0, 500) : null }));
}
// A matchup — the top-level unit. Takes + comments hang off it.
export interface Matchup { ownLeader: string; ownBase: string; oppLeader: string; oppBase: string }
const takeWhere = (teamSlug: string, m: Matchup) =>
  and(eq(sideboardTakes.teamSlug, teamSlug), eq(sideboardTakes.ownLeader, m.ownLeader), eq(sideboardTakes.ownBase, m.ownBase), eq(sideboardTakes.oppLeader, m.oppLeader), eq(sideboardTakes.oppBase, m.oppBase));

// Upsert the caller's ONE take for a matchup (insert or replace).
export async function upsertMyTake(teamSlug: string, authorId: string, m: Matchup, notes: string, cardsIn: GuideCard[], cardsOut: GuideCard[]): Promise<void> {
  await getDb().insert(sideboardTakes)
    .values({ id: randomUUID(), teamSlug, authorId, ...m, notes, cardsIn, cardsOut })
    .onConflictDoUpdate({
      target: [sideboardTakes.teamSlug, sideboardTakes.ownLeader, sideboardTakes.ownBase, sideboardTakes.oppLeader, sideboardTakes.oppBase, sideboardTakes.authorId],
      set: { notes, cardsIn, cardsOut, updatedAt: new Date() },
    });
}

export async function deleteMyTake(teamSlug: string, authorId: string, m: Matchup): Promise<void> {
  await getDb().delete(sideboardTakes).where(and(takeWhere(teamSlug, m), eq(sideboardTakes.authorId, authorId)));
}

// Every take on a matchup, author-attributed (newest first).
export async function matchupTakes(teamSlug: string, m: Matchup) {
  return getDb()
    .select({ id: sideboardTakes.id, authorId: sideboardTakes.authorId, authorName: users.name, notes: sideboardTakes.notes, cardsIn: sideboardTakes.cardsIn, cardsOut: sideboardTakes.cardsOut, updatedAt: sideboardTakes.updatedAt })
    .from(sideboardTakes)
    .leftJoin(users, eq(users.id, sideboardTakes.authorId))
    .where(takeWhere(teamSlug, m))
    .orderBy(desc(sideboardTakes.updatedAt));
}

// The team's matchups (grouped takes) for the browse list.
export interface MatchupSummary extends Matchup { takeCount: number; contributors: (string | null)[]; myTake: boolean }
export async function listTeamMatchups(teamSlug: string, viewerId: string): Promise<MatchupSummary[]> {
  const rows = await getDb()
    .select({ ownLeader: sideboardTakes.ownLeader, ownBase: sideboardTakes.ownBase, oppLeader: sideboardTakes.oppLeader, oppBase: sideboardTakes.oppBase, authorId: sideboardTakes.authorId, authorName: users.name, updatedAt: sideboardTakes.updatedAt })
    .from(sideboardTakes)
    .leftJoin(users, eq(users.id, sideboardTakes.authorId))
    .where(eq(sideboardTakes.teamSlug, teamSlug));
  const byKey = new Map<string, MatchupSummary & { latest: number }>();
  for (const r of rows) {
    const key = [r.ownLeader, r.ownBase, r.oppLeader, r.oppBase].join('');
    let s = byKey.get(key);
    if (!s) { s = { ownLeader: r.ownLeader, ownBase: r.ownBase, oppLeader: r.oppLeader, oppBase: r.oppBase, takeCount: 0, contributors: [], myTake: false, latest: 0 }; byKey.set(key, s); }
    s.takeCount++; s.contributors.push(r.authorName);
    if (r.authorId === viewerId) s.myTake = true;
    s.latest = Math.max(s.latest, new Date(r.updatedAt).getTime());
  }
  return [...byKey.values()].sort((a, b) => b.latest - a.latest).map(({ latest, ...s }) => s);
}

// Consensus: cards ranked by how many of the matchup's takes bring them in / cut
// them. High count = the team plan; a split = the debate.
export interface ConsensusCard { cardId: string; count: number }
export function computeConsensus(takes: { cardsIn: GuideCard[]; cardsOut: GuideCard[] }[]): { inCards: ConsensusCard[]; outCards: ConsensusCard[]; total: number } {
  const total = takes.length;
  const tally = (key: 'cardsIn' | 'cardsOut') => {
    const m = new Map<string, number>();
    for (const t of takes) {
      const seen = new Set<string>();
      for (const c of (t[key] || [])) if (c?.cardId && !seen.has(c.cardId)) { seen.add(c.cardId); m.set(c.cardId, (m.get(c.cardId) || 0) + 1); }
    }
    return [...m.entries()].map(([cardId, count]) => ({ cardId, count })).sort((a, b) => b.count - a.count || a.cardId.localeCompare(b.cardId));
  };
  return { inCards: tally('cardsIn'), outCards: tally('cardsOut'), total };
}

// ── Matchup comments (any team member; keyed by the matchup) ────────────────
export async function listMatchupComments(teamSlug: string, m: Matchup) {
  return getDb()
    .select({ id: sideboardMatchupComments.id, body: sideboardMatchupComments.body, authorId: sideboardMatchupComments.authorId, authorName: users.name, createdAt: sideboardMatchupComments.createdAt })
    .from(sideboardMatchupComments)
    .leftJoin(users, eq(users.id, sideboardMatchupComments.authorId))
    .where(and(eq(sideboardMatchupComments.teamSlug, teamSlug), eq(sideboardMatchupComments.ownLeader, m.ownLeader), eq(sideboardMatchupComments.ownBase, m.ownBase), eq(sideboardMatchupComments.oppLeader, m.oppLeader), eq(sideboardMatchupComments.oppBase, m.oppBase)))
    .orderBy(sideboardMatchupComments.createdAt);
}

export async function addMatchupComment(teamSlug: string, authorId: string, m: Matchup, body: string): Promise<string> {
  const id = randomUUID();
  await getDb().insert(sideboardMatchupComments).values({ id, teamSlug, authorId, ...m, body });
  return id;
}

export async function deleteMatchupComment(id: string, authorId: string): Promise<boolean> {
  const res = await getDb()
    .delete(sideboardMatchupComments)
    .where(and(eq(sideboardMatchupComments.id, id), eq(sideboardMatchupComments.authorId, authorId)))
    .returning({ id: sideboardMatchupComments.id });
  return res.length > 0;
}
