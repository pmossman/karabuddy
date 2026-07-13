// B231: Sideboard Guides — team-shared, matchup-scoped "cards good (IN) / bad
// (OUT) in this matchup" + notes. This module owns the data: the frequency-
// sorted card POOL (aggregated from the team's decklists for an archetype), the
// guide CRUD (author-owned, team-visible), and the matchup options that feed
// the authoring selectors.

import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNotNull, desc } from 'drizzle-orm';
import { getDb } from './db';
import { replays, replayTeamShares, teamMembers, sideboardGuides, sideboardGuideComments, cards, users } from './schema';
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
export interface GuideInput {
  teamSlug: string; authorId: string;
  ownLeader: string; ownBase: string; oppLeader: string; oppBase: string;
  title: string | null; notes: string;
  cardsIn: GuideCard[]; cardsOut: GuideCard[];
}

export async function listGuides(teamSlug: string) {
  return getDb()
    .select({
      id: sideboardGuides.id, ownLeader: sideboardGuides.ownLeader, ownBase: sideboardGuides.ownBase,
      oppLeader: sideboardGuides.oppLeader, oppBase: sideboardGuides.oppBase, title: sideboardGuides.title,
      notes: sideboardGuides.notes, cardsIn: sideboardGuides.cardsIn, cardsOut: sideboardGuides.cardsOut,
      authorId: sideboardGuides.authorId, authorName: users.name, updatedAt: sideboardGuides.updatedAt,
    })
    .from(sideboardGuides)
    .leftJoin(users, eq(users.id, sideboardGuides.authorId))
    .where(eq(sideboardGuides.teamSlug, teamSlug))
    .orderBy(desc(sideboardGuides.updatedAt));
}

export async function getGuide(id: string) {
  const [row] = await getDb()
    .select({
      id: sideboardGuides.id, teamSlug: sideboardGuides.teamSlug, ownLeader: sideboardGuides.ownLeader,
      ownBase: sideboardGuides.ownBase, oppLeader: sideboardGuides.oppLeader, oppBase: sideboardGuides.oppBase,
      title: sideboardGuides.title, notes: sideboardGuides.notes, cardsIn: sideboardGuides.cardsIn,
      cardsOut: sideboardGuides.cardsOut, authorId: sideboardGuides.authorId, authorName: users.name,
      createdAt: sideboardGuides.createdAt, updatedAt: sideboardGuides.updatedAt,
    })
    .from(sideboardGuides)
    .leftJoin(users, eq(users.id, sideboardGuides.authorId))
    .where(eq(sideboardGuides.id, id))
    .limit(1);
  return row ?? null;
}

export async function createGuide(input: GuideInput): Promise<string> {
  const id = randomUUID();
  await getDb().insert(sideboardGuides).values({
    id, teamSlug: input.teamSlug, authorId: input.authorId,
    ownLeader: input.ownLeader, ownBase: input.ownBase, oppLeader: input.oppLeader, oppBase: input.oppBase,
    title: input.title, notes: input.notes, cardsIn: input.cardsIn, cardsOut: input.cardsOut,
  });
  return id;
}

// Author-only edit. Returns false if the guide doesn't exist or isn't the
// author's (the route maps that to 403/404).
export async function updateGuide(id: string, authorId: string, patch: Partial<Omit<GuideInput, 'teamSlug' | 'authorId'>>): Promise<boolean> {
  const res = await getDb()
    .update(sideboardGuides)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(sideboardGuides.id, id), eq(sideboardGuides.authorId, authorId)))
    .returning({ id: sideboardGuides.id });
  return res.length > 0;
}

export async function deleteGuide(id: string, authorId: string): Promise<boolean> {
  const res = await getDb()
    .delete(sideboardGuides)
    .where(and(eq(sideboardGuides.id, id), eq(sideboardGuides.authorId, authorId)))
    .returning({ id: sideboardGuides.id });
  return res.length > 0;
}

// ── Comments (any team member; not gated by guide authorship) ───────────────

export async function listGuideComments(guideId: string) {
  return getDb()
    .select({
      id: sideboardGuideComments.id, body: sideboardGuideComments.body,
      authorId: sideboardGuideComments.authorId, authorName: users.name, createdAt: sideboardGuideComments.createdAt,
    })
    .from(sideboardGuideComments)
    .leftJoin(users, eq(users.id, sideboardGuideComments.authorId))
    .where(eq(sideboardGuideComments.guideId, guideId))
    .orderBy(sideboardGuideComments.createdAt);
}

export async function addGuideComment(guideId: string, authorId: string, body: string): Promise<string> {
  const id = randomUUID();
  await getDb().insert(sideboardGuideComments).values({ id, guideId, authorId, body });
  return id;
}

export async function deleteGuideComment(id: string, authorId: string): Promise<boolean> {
  const res = await getDb()
    .delete(sideboardGuideComments)
    .where(and(eq(sideboardGuideComments.id, id), eq(sideboardGuideComments.authorId, authorId)))
    .returning({ id: sideboardGuideComments.id });
  return res.length > 0;
}
