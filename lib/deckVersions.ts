// Deck version reconstruction from replays. Groups a user's replays by archetype
// (leader identity + base functional identity) and reconstructs each deck's
// VERSION HISTORY from the timestamps: consecutive games whose combined
// MAIN+SIDEBOARD set is identical are one version; the set changing = a new
// version. Sideboarding just repartitions the registered list, so it never
// creates a version. Limited games (< 50-card maindeck) are skipped.
//
// This powers the karabuddy → SWU Forge migration review (and a standalone
// "deck timeline" view). Pure detection is separate from the DB resolver so it's
// unit-testable without infra.

import { and, eq, or, inArray, isNotNull } from 'drizzle-orm';
import { getDb } from './db';
import { replays, extensionTokens, cards } from './schema';
import { resolveBaseIdentities, type BaseIdentity } from './baseIdentity';
import { leaderValue } from './sideboardGuides';
import { cardIdFromSetNumber } from './cards';

export interface CardRef { id: string; count: number; name?: string | null; cost?: number | null }
export interface DeckVersion {
  label: string;              // "v1", "v2", …
  main: CardRef[];            // representative maindeck (most common partition in the version)
  sideboard: CardRef[];
  size: number; sideSize: number;
  games: number; wins: number; losses: number;
  startAt: string; endAt: string;      // ISO date (YYYY-MM-DD)
  diff: { added: CardRef[]; removed: CardRef[] } | null; // vs the previous version's registered set
}
export interface DerivedDeck {
  key: string;                // archetype id (leaderValue | baseIdentity.key)
  leader: { name: string; subtitle: string | null; set: string | null; number: number | null };
  base: BaseIdentity;
  games: number; wins: number; losses: number;
  startAt: string; endAt: string;
  versions: DeckVersion[];
}

// ── pure detection ─────────────────────────────────────────────────────────
type Cnt = Map<string, number>;
const countOf = (list: { id: string; count?: number }[]): Cnt => {
  const m: Cnt = new Map();
  for (const c of list || []) if (c?.id) m.set(c.id, (m.get(c.id) || 0) + (c.count || 0));
  return m;
};
const merge = (...ms: Cnt[]): Cnt => { const o: Cnt = new Map(); for (const m of ms) for (const [k, v] of m) o.set(k, (o.get(k) || 0) + v); return o; };
const totalOf = (m: Cnt) => [...m.values()].reduce((a, b) => a + b, 0);
const sigOf = (m: Cnt) => [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([id, n]) => `${id}:${n}`).join(',');
const toRefs = (m: Cnt): CardRef[] => [...m.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => a.id.localeCompare(b.id));
function setDiff(prev: Cnt, next: Cnt) {
  const ids = new Set([...prev.keys(), ...next.keys()]);
  const added: CardRef[] = [], removed: CardRef[] = [];
  for (const id of ids) { const d = (next.get(id) || 0) - (prev.get(id) || 0); if (d > 0) added.push({ id, count: d }); else if (d < 0) removed.push({ id, count: -d }); }
  return { added, removed };
}

/** One replay's registered list for an archetype, plus outcome + time. */
export interface ReplayList { main: { id: string; count: number }[]; sideboard: { id: string; count: number }[]; t: number; win: boolean | null }

/**
 * Reconstruct versions for ONE archetype's replays (pure).
 * A version = a run of consecutive (time-ordered) games with an identical
 * combined main+sideboard set. Representative list = the most common maindeck
 * partition within the version (its "default" build).
 */
export function detectDeckVersions(replaysIn: ReplayList[]): DeckVersion[] {
  const recs = replaysIn
    .map((r) => ({ main: countOf(r.main), side: countOf(r.sideboard), t: r.t, win: r.win }))
    .filter((r) => totalOf(r.main) >= 50) // skip limited (sealed/draft)
    .sort((a, b) => a.t - b.t);
  if (!recs.length) return [];

  // group consecutive-identical combined sets
  const runs: (typeof recs)[] = [];
  let curSig: string | null = null;
  for (const r of recs) {
    const s = sigOf(merge(r.main, r.side));
    if (s !== curSig) { runs.push([r]); curSig = s; } else runs[runs.length - 1].push(r);
  }

  let prevCombined: Cnt | null = null;
  return runs.map((members, i) => {
    // representative maindeck = the most common exact maindeck partition in the run
    const byMain = new Map<string, typeof members>();
    for (const m of members) { const s = sigOf(m.main); (byMain.get(s) ?? byMain.set(s, []).get(s)!).push(m); }
    const rep = [...byMain.values()].sort((a, b) => b.length - a.length)[0][0];
    const combined = merge(rep.main, rep.side);
    const diff = prevCombined ? setDiff(prevCombined, combined) : null;
    prevCombined = combined;
    return {
      label: `v${i + 1}`,
      main: toRefs(rep.main), sideboard: toRefs(rep.side),
      size: totalOf(rep.main), sideSize: totalOf(rep.side),
      games: members.length,
      wins: members.filter((m) => m.win === true).length,
      losses: members.filter((m) => m.win === false).length,
      startAt: new Date(members[0].t).toISOString().slice(0, 10),
      endAt: new Date(members[members.length - 1].t).toISOString().slice(0, 10),
      diff,
    };
  });
}

// ── DB resolver ────────────────────────────────────────────────────────────

/** Export scope: the user + all their claimed install tokens (every device). */
async function scopedReplays(userId: string) {
  const db = getDb();
  const tokens = (await db.select({ token: extensionTokens.token }).from(extensionTokens).where(eq(extensionTokens.userId, userId))).map((r) => r.token);
  const owner = tokens.length ? or(eq(replays.userId, userId), inArray(replays.ownerToken, tokens)) : eq(replays.userId, userId);
  return db.select({ players: replays.players, decks: replays.decks, pov: replays.ownerPlayerId, winners: replays.winners, createdAt: replays.createdAt })
    .from(replays)
    .where(and(owner, eq(replays.encrypted, false), isNotNull(replays.decks), isNotNull(replays.ownerPlayerId)));
}

/**
 * Build the user's decks-with-versions from their own-POV replays. Excludes
 * encrypted replays (undecodable) and limited games. Sorted by games desc.
 */
export async function resolveUserDecks(userId: string, opts?: { minGames?: number }): Promise<DerivedDeck[]> {
  const minGames = opts?.minGames ?? 3;
  const db = getDb();
  const rows = await scopedReplays(userId);

  const baseRefs = rows.map((r) => (Array.isArray(r.players) ? (r.players as any[]).find((p) => p?.id === r.pov)?.base : null)).filter(Boolean);
  const baseIds = await resolveBaseIdentities(baseRefs as any);
  const leaderCards = await db.select({ set: cards.set, number: cards.number, subtitle: cards.subtitle }).from(cards).where(eq(cards.type, 'leader'));
  const subMap = new Map(leaderCards.map((c) => [`${c.set}|${c.number}`, c.subtitle ?? null]));

  type Group = { leader: DerivedDeck['leader']; base: BaseIdentity; lists: ReplayList[] };
  const byArch = new Map<string, Group>();
  for (const r of rows) {
    const owner = Array.isArray(r.players) ? (r.players as any[]).find((p) => p?.id === r.pov) : null;
    if (!owner?.leader?.name || !owner?.base) continue;
    const d = (r.decks as any)?.[r.pov as string];
    if (!Array.isArray(d?.deck)) continue;
    const subtitle = subMap.get(`${owner.leader.set}|${owner.leader.number}`) ?? null;
    const lv = leaderValue(owner.leader.name, subtitle);
    const baseId = baseIds.get(cardIdFromSetNumber(owner.base.set, owner.base.number));
    if (!baseId) continue;
    const key = `${lv}|${baseId.key}`;
    if (!byArch.has(key)) byArch.set(key, {
      leader: { name: owner.leader.name, subtitle, set: owner.leader.set ?? null, number: owner.leader.number ?? null },
      base: baseId, lists: [],
    });
    const winners = Array.isArray(r.winners) ? (r.winners as string[]) : null;
    byArch.get(key)!.lists.push({
      main: d.deck, sideboard: Array.isArray(d.sideboard) ? d.sideboard : [],
      t: new Date(r.createdAt as any).getTime(),
      win: winners == null ? null : winners.includes(r.pov as string),
    });
  }

  const decks: DerivedDeck[] = [];
  for (const [key, g] of byArch) {
    const versions = detectDeckVersions(g.lists);
    const games = versions.reduce((s, v) => s + v.games, 0);
    if (games < minGames) continue; // needs enough constructed games to be meaningful
    decks.push({
      key, leader: g.leader, base: g.base, versions, games,
      wins: versions.reduce((s, v) => s + v.wins, 0),
      losses: versions.reduce((s, v) => s + v.losses, 0),
      startAt: versions[0]?.startAt ?? '', endAt: versions[versions.length - 1]?.endAt ?? '',
    });
  }

  // Resolve card names for the version lists + diffs (one catalog query).
  const ids = new Set<string>();
  for (const d of decks) for (const v of d.versions) { for (const c of v.main) ids.add(c.id); for (const c of v.sideboard) ids.add(c.id); for (const c of v.diff?.added ?? []) ids.add(c.id); for (const c of v.diff?.removed ?? []) ids.add(c.id); }
  const meta = ids.size ? await db.select({ cardId: cards.cardId, name: cards.name, cost: cards.cost }).from(cards).where(inArray(cards.cardId, [...ids])) : [];
  const nameOf = new Map(meta.map((m) => [m.cardId, { name: m.name, cost: m.cost }]));
  const label = (c: CardRef): CardRef => ({ ...c, name: nameOf.get(c.id)?.name ?? c.id, cost: nameOf.get(c.id)?.cost ?? null });
  for (const d of decks) for (const v of d.versions) {
    v.main = v.main.map(label); v.sideboard = v.sideboard.map(label);
    if (v.diff) { v.diff.added = v.diff.added.map(label); v.diff.removed = v.diff.removed.map(label); }
  }

  return decks.sort((a, b) => b.games - a.games);
}
