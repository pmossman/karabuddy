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
import { cardIdFromSetNumber } from './cards';

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
  const wantName = leaderNameOf(ownLeaderName); // the pool keys on the leader NAME
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
    if (!me || me.leader?.name !== wantName) continue;
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

// A leader is identified by name + SUBTITLE (like cards) — "Luke Skywalker" has
// several versions. `value` (the "name · subtitle" identity) is what's stored on
// a matchup; name/subtitle drive the display.
export const LEADER_SEP = ' · ';
export const leaderValue = (name: string, subtitle: string | null | undefined) => (subtitle ? `${name}${LEADER_SEP}${subtitle}` : name);
export const leaderNameOf = (value: string) => value.split(LEADER_SEP)[0];
export interface LeaderOption { value: string; name: string; subtitle: string | null; set: string | null; number: number | null }
// A played ARCHETYPE = leader + base, with how often the team played/faced it —
// the streamlined "pick your deck" option (vs picking leader + base separately).
export interface Archetype { leader: LeaderOption; base: BaseIdentity; count: number }
export interface MatchupOptions {
  ownLeaders: LeaderOption[]; oppLeaders: LeaderOption[];
  // Bases use the ONE base identity system (lib/baseIdentity): vanilla bases
  // collapse to their aspect (rendered as the aspect icon, no name), unique
  // bases stay themselves (own art + name). Keyed by functional identity.
  ownBaseKinds: BaseIdentity[]; oppBaseKinds: BaseIdentity[];
  // Leader+base decks the team plays (own) / faces (opp), popularity-sorted.
  ownArchetypes: Archetype[]; oppArchetypes: Archetype[];
}
// The team's played leaders (by name) + base functional KINDS, split by side,
// for the authoring matchup selectors. Own = the recorder's; opp = the other.
export async function teamMatchupOptions(teamSlug: string): Promise<MatchupOptions> {
  const rows = await getDb()
    .select({ ownerPlayerId: replays.ownerPlayerId, players: replays.players })
    .from(replays)
    .innerJoin(replayTeamShares, eq(replayTeamShares.replaySlug, replays.slug))
    .where(eq(replayTeamShares.teamSlug, teamSlug));

  const rawOwn: any[] = [], rawOpp: any[] = [];
  const ownBaseRefs: any[] = [], oppBaseRefs: any[] = [];
  const ownPairs: { leader: any; base: any }[] = [], oppPairs: { leader: any; base: any }[] = [];
  for (const r of rows) {
    for (const p of (Array.isArray(r.players) ? (r.players as any[]) : [])) {
      const own = p?.id === r.ownerPlayerId;
      if (p?.leader?.name) (own ? rawOwn : rawOpp).push(p.leader);
      if (p?.base) (own ? ownBaseRefs : oppBaseRefs).push(p.base);
      if (p?.leader?.name && p?.base?.set && p?.base?.number != null) (own ? ownPairs : oppPairs).push({ leader: p.leader, base: p.base });
    }
  }
  // Resolve leader subtitles from the catalog (set+number → subtitle) so same-name
  // leaders (multiple "Luke Skywalker"s) get distinct identities.
  const db = getDb();
  const leaderCards = await db.select({ set: cards.set, number: cards.number, subtitle: cards.subtitle }).from(cards).where(eq(cards.type, 'leader'));
  const subMap = new Map(leaderCards.map((c) => [`${c.set}|${c.number}`, c.subtitle ?? null]));
  const buildLeaders = (raw: any[]) => {
    const m = new Map<string, LeaderOption>();
    for (const c of raw) {
      const subtitle = subMap.get(`${c.set}|${c.number}`) ?? null;
      const value = leaderValue(c.name, subtitle);
      if (!m.has(value)) m.set(value, { value, name: c.name, subtitle, set: c.set ?? null, number: c.number ?? null });
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name) || (a.subtitle ?? '').localeCompare(b.subtitle ?? ''));
  };
  const [ownIds, oppIds] = await Promise.all([resolveBaseIdentities(ownBaseRefs), resolveBaseIdentities(oppBaseRefs)]);
  const distinctKinds = (ids: Map<string, BaseIdentity>) => {
    const byKey = new Map<string, BaseIdentity>();
    for (const k of ids.values()) if (!byKey.has(k.key)) byKey.set(k.key, k);
    return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
  };
  // Archetypes: (leader identity + base identity) pairs, counted for popularity.
  const buildArchetypes = (pairs: { leader: any; base: any }[], baseIds: Map<string, BaseIdentity>): Archetype[] => {
    const m = new Map<string, Archetype>();
    for (const { leader, base } of pairs) {
      const subtitle = subMap.get(`${leader.set}|${leader.number}`) ?? null;
      const lo: LeaderOption = { value: leaderValue(leader.name, subtitle), name: leader.name, subtitle, set: leader.set ?? null, number: leader.number ?? null };
      const baseId = baseIds.get(cardIdFromSetNumber(base.set, base.number));
      if (!baseId) continue;
      const key = `${lo.value}|${baseId.key}`;
      const e = m.get(key);
      if (e) e.count++; else m.set(key, { leader: lo, base: baseId, count: 1 });
    }
    return [...m.values()].sort((a, b) => b.count - a.count || a.leader.name.localeCompare(b.leader.name));
  };
  return {
    ownLeaders: buildLeaders(rawOwn), oppLeaders: buildLeaders(rawOpp),
    ownBaseKinds: distinctKinds(ownIds), oppBaseKinds: distinctKinds(oppIds),
    ownArchetypes: buildArchetypes(ownPairs, ownIds), oppArchetypes: buildArchetypes(oppPairs, oppIds),
  };
}

// Leader IDENTITY (name·subtitle) -> art + name/subtitle for display.
export interface LeaderArt { set: string | null; number: number | null; name: string; subtitle: string | null }
export function leaderArtFromMatchups(m: MatchupOptions): Record<string, LeaderArt> {
  const map: Record<string, LeaderArt> = {};
  for (const list of [m.ownLeaders, m.oppLeaders]) for (const o of list) if (!map[o.value]) map[o.value] = { set: o.set, number: o.number, name: o.name, subtitle: o.subtitle };
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
export async function matchupContextForTeam(teamSlug: string): Promise<{ leaderArt: Record<string, LeaderArt>; baseKinds: Record<string, BaseIdentity> }> {
  const m = await teamMatchupOptions(teamSlug);
  return { leaderArt: leaderArtFromMatchups(m), baseKinds: baseKindsByKey(m) };
}

// ── Guide CRUD ────────────────────────────────────────────────────────────

// Consensus math + qty helpers live in the pure, client-safe lib/sideboardConsensus
// (no db imports) so the server and the guides UI share one implementation.
export { MAX_QTY, guideQty, sumQty, computeConsensus, modeQty, analyzeMatchupConsensus } from './sideboardConsensus';
export type { GuideCard, ConsensusCard, MatchupConsensus, SplitCard, PlanCard, ConsensusMember } from './sideboardConsensus';
import { guideQty, type GuideCard } from './sideboardConsensus';

// Clamp untrusted IN/OUT card lists from the client to the stored shape.
export function sanitizeGuideCards(arr: unknown): GuideCard[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((c): c is { cardId: string; qty?: unknown; note?: unknown } => !!c && typeof (c as any).cardId === 'string' && (c as any).cardId.trim().length > 0)
    .map((c) => ({ cardId: c.cardId.trim(), qty: guideQty(c as any), note: typeof c.note === 'string' && c.note.trim() ? c.note.trim().slice(0, 500) : null }));
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
