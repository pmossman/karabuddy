// PROTOTYPE (throwaway — swuforge migration): reconstruct a deck's VERSION HISTORY
// from replay timestamps. Group a user's replays by archetype (leader identity +
// base functional identity), order by time, and split into versions when the
// maindeck changes by more than a threshold T (so 1-card tech swaps / mis-captures
// don't each spawn a version). Each version → its list, date range, games, W-L,
// and the human-readable diff from the previous version (+X / −Y cards).
//
// This is the data behind swuforge's deckHistory: v1 → v2 → v3 as the list evolved.
//
// LOCAL ONLY (.env.development.local; snapshot). Read-only.
//   npx tsx scripts/prototype-deck-versions.ts [userId] [--t=4] [--min=3]
//     --t   = version-boundary threshold (total cards changed vs the version anchor)
//     --min = only show archetypes with >= this many complete-deck games

import { config } from 'dotenv';
config({ path: '.env.development.local' });

type DeckMap = Map<string, number>; // cardId -> count
const mapOf = (deck: any[]): DeckMap => { const m = new Map<string, number>(); for (const c of deck || []) if (c?.id) m.set(c.id, (m.get(c.id) || 0) + (c.count || 0)); return m; };
const merge = (...maps: DeckMap[]): DeckMap => { const m = new Map<string, number>(); for (const mp of maps) for (const [k, v] of mp) m.set(k, (m.get(k) || 0) + v); return m; };
const total = (m: DeckMap) => [...m.values()].reduce((a, b) => a + b, 0);
const sig = (m: DeckMap) => [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([id, n]) => `${id}:${n}`).join(',');
function diff(a: DeckMap, b: DeckMap) {
  const ids = new Set([...a.keys(), ...b.keys()]); const added: [string, number][] = [], removed: [string, number][] = []; let size = 0;
  for (const id of ids) { const d = (b.get(id) || 0) - (a.get(id) || 0); if (d > 0) added.push([id, d]); else if (d < 0) removed.push([id, -d]); size += Math.abs(d); }
  return { added, removed, size };
}
const fmtDate = (t: number) => new Date(t).toISOString().slice(0, 10);

async function main() {
  const args = process.argv.slice(2);
  const userArg = args.find((a) => !a.startsWith('--')) || null;
  // A version = the combined MAIN+SIDEBOARD set (sideboarding just repartitions
  // the registered list, so it doesn't change the union). T=0 → any real change to
  // the registered set is a new version. A 50-card no-sideboard deck is a VALID
  // state (Bo1 testing before a sideboard is added), so we DON'T filter on
  // sideboard size — only a partial MAINDECK (< 50, e.g. nextSet fragments) can't
  // form a legal deck and is excluded. SIDEMIN stays available for experiments.
  const T = Number(args.find((a) => a.startsWith('--t='))?.split('=')[1] ?? 0);
  const MIN = Number(args.find((a) => a.startsWith('--min='))?.split('=')[1] ?? 8);
  const MINV = Number(args.find((a) => a.startsWith('--minv='))?.split('=')[1] ?? 1);

  const { getDb } = await import('../lib/db');
  const { replays, extensionTokens, users, cards } = await import('../lib/schema');
  const { and, eq, or, inArray, isNotNull } = await import('drizzle-orm');
  const { resolveBaseIdentities } = await import('../lib/baseIdentity');
  const { leaderValue } = await import('../lib/sideboardGuides');
  const db = getDb();

  // Pick a user (default: top by qualifying replays)
  let userId = userArg;
  const qualifies = and(eq(replays.encrypted, false), isNotNull(replays.decks), isNotNull(replays.ownerPlayerId));
  if (!userId) {
    const rows = await db.select({ userId: replays.userId }).from(replays).where(and(qualifies, isNotNull(replays.userId)));
    const c = new Map<string, number>(); for (const r of rows) if (r.userId) c.set(r.userId, (c.get(r.userId) || 0) + 1);
    userId = [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }
  if (!userId) { console.log('no user'); return; }
  const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));

  const tokens = (await db.select({ token: extensionTokens.token }).from(extensionTokens).where(eq(extensionTokens.userId, userId))).map((r) => r.token);
  const ownerFilter = tokens.length ? or(eq(replays.userId, userId), inArray(replays.ownerToken, tokens)) : eq(replays.userId, userId);
  const rows = await db.select({ players: replays.players, decks: replays.decks, pov: replays.ownerPlayerId, winners: replays.winners, createdAt: replays.createdAt })
    .from(replays).where(and(ownerFilter, qualifies));

  // Build per-replay records; group by archetype
  const baseRefs = rows.map((r) => (Array.isArray(r.players) ? (r.players as any[]).find((p) => p?.id === r.pov)?.base : null)).filter(Boolean);
  const baseIds = await resolveBaseIdentities(baseRefs as any);
  const leaderCards = await db.select({ set: cards.set, number: cards.number, subtitle: cards.subtitle }).from(cards).where(eq(cards.type, 'leader'));
  const subMap = new Map(leaderCards.map((c) => [`${c.set}|${c.number}`, c.subtitle ?? null]));
  const CARD = (s: string, n: number | string) => `${s}_${String(Number(n)).padStart(3, '0')}`;

  type Rec = { t: number; deck: DeckMap; sideboard: any[]; win: boolean | null; leaderName: string; baseLabel: string };
  const byArch = new Map<string, { leaderName: string; baseLabel: string; recs: Rec[] }>();
  let skipped = 0;
  for (const r of rows) {
    const owner = Array.isArray(r.players) ? (r.players as any[]).find((p) => p?.id === r.pov) : null;
    if (!owner?.leader?.name || !owner?.base) continue;
    const d = (r.decks as any)?.[r.pov!];
    if (!d?.deck) continue;
    const main = mapOf(d.deck), side = mapOf(d.sideboard || []);
    // Skip limited games (sealed/draft = ~30-card decks) — you don't migrate those.
    // Everything 50+ is a constructed deck; a 50+0 (no sideboard, Bo1 testing) is a
    // valid state. Version identity = the combined registered set (main ∪ sideboard).
    if (total(main) < 50) { skipped++; continue; }
    const deck = merge(main, side);
    const subtitle = subMap.get(`${owner.leader.set}|${owner.leader.number}`) ?? null;
    const lv = leaderValue(owner.leader.name, subtitle);
    const baseId = baseIds.get(CARD(owner.base.set, owner.base.number));
    const key = `${lv}|${baseId?.key ?? owner.base.name}`;
    const leaderName = subtitle ? `${owner.leader.name} · ${subtitle}` : owner.leader.name;
    const baseLabel = baseId?.label ?? owner.base.name;
    const winners = Array.isArray(r.winners) ? (r.winners as string[]) : null;
    const win = winners == null ? null : winners.includes(r.pov!);
    if (!byArch.has(key)) byArch.set(key, { leaderName, baseLabel, recs: [] });
    byArch.get(key)!.recs.push({ t: new Date(r.createdAt as any).getTime(), deck, sideboard: d.sideboard || [], win, leaderName, baseLabel });
  }

  const repOf = (members: Rec[]): Rec => {
    const bySig = new Map<string, Rec[]>();
    for (const m of members) { const s = sig(m.deck); (bySig.get(s) ?? bySig.set(s, []).get(s)!).push(m); }
    return [...bySig.entries()].sort((a, b) => b[1].length - a[1].length)[0][1][0]; // most-common exact list
  };

  // Version detection, two passes:
  //  1) split into runs when a game's list differs from the run ANCHOR by > T cards;
  //  2) CONSOLIDATE — repeatedly merge any run with < minV games into the neighbour
  //     whose representative list is closest, absorbing per-game sideboard/tech blips
  //     so only SUSTAINED versions survive (the real evolution).
  function detect(recs: Rec[], t: number, minV: number) {
    const sorted = [...recs].sort((a, b) => a.t - b.t);
    let runs: Rec[][] = [];
    for (const r of sorted) {
      const cur = runs[runs.length - 1];
      if (!cur || diff(repOf(cur).deck, r.deck).size > t) runs.push([r]);
      else cur.push(r);
    }
    while (runs.length > 1) {
      let idx = -1, smallest = Infinity;
      runs.forEach((run, i) => { if (run.length < minV && run.length < smallest) { smallest = run.length; idx = i; } });
      if (idx < 0) break; // all runs >= minV
      const rep = repOf(runs[idx]).deck;
      const neighbours = [idx - 1, idx + 1].filter((j) => j >= 0 && j < runs.length);
      const target = neighbours.sort((a, b) => diff(repOf(runs[a]).deck, rep).size - diff(repOf(runs[b]).deck, rep).size)[0];
      runs[target] = [...runs[target], ...runs[idx]].sort((a, b) => a.t - b.t);
      runs.splice(idx, 1);
    }
    // Final pass: merge adjacent versions whose representative MAINDECK is identical
    // — the same version split only by per-game sideboard swaps, not a new list.
    for (let i = runs.length - 1; i > 0; i--) {
      if (diff(repOf(runs[i - 1]).deck, repOf(runs[i]).deck).size === 0) {
        runs[i - 1] = [...runs[i - 1], ...runs[i]].sort((a, b) => a.t - b.t);
        runs.splice(i, 1);
      }
    }
    return runs.map((members) => {
      const rep = repOf(members);
      const wins = members.filter((m) => m.win === true).length;
      const losses = members.filter((m) => m.win === false).length;
      const distinct = new Set(members.map((m) => sig(m.deck))).size;
      return { rep: rep.deck, sideboard: rep.sideboard, games: members.length, wins, losses,
        start: members[0].t, end: members[members.length - 1].t, distinctLists: distinct };
    });
  }

  // Resolve names for readable diffs
  const archs = [...byArch.values()].filter((a) => a.recs.length >= MIN).sort((x, y) => y.recs.length - x.recs.length);
  const allIds = new Set<string>(); for (const a of archs) for (const r of a.recs) for (const id of r.deck.keys()) allIds.add(id);
  const nameRows = allIds.size ? await db.select({ cardId: cards.cardId, name: cards.name }).from(cards).where(inArray(cards.cardId, [...allIds])) : [];
  const nameOf = new Map(nameRows.map((r) => [r.cardId, r.name ?? r.cardId]));
  const showDiff = (d: ReturnType<typeof diff>) => [
    ...d.added.map(([id, n]) => `+${n} ${nameOf.get(id) ?? id}`),
    ...d.removed.map(([id, n]) => `−${n} ${nameOf.get(id) ?? id}`),
  ].join(', ');

  console.log(`User ${u?.name ?? userId} — deck version detection`);
  console.log(`Version = the combined MAIN+SIDEBOARD set (sideboarding ignored). ${skipped} limited games (< 50 cards) skipped.\n`);
  console.log('Versions per archetype (T=' + T + ' change to the 60 = new version):');
  console.log('  games   versions   archetype');
  for (const a of archs) {
    const n = detect(a.recs, T, MINV).length;
    console.log(`  ${String(a.recs.length).padStart(5)}      ${String(n).padStart(3)}      ${a.leaderName} — ${a.baseLabel}`);
  }

  console.log(`\n── Version timelines ──`);
  for (const a of archs.slice(0, 6)) {
    const vs = detect(a.recs, T, MINV);
    console.log(`\n${a.leaderName} — ${a.baseLabel}   (${a.recs.length} games → ${vs.length} versions)`);
    vs.forEach((v, i) => {
      const wr = v.wins + v.losses ? Math.round((v.wins / (v.wins + v.losses)) * 100) : null;
      const change = i === 0 ? 'initial list' : showDiff(diff(vs[i - 1].rep, v.rep)) || '(revisited an earlier list)';
      console.log(`  v${i + 1}  ${fmtDate(v.start)}–${fmtDate(v.end)}  ${String(v.games).padStart(3)} games  ${String(v.wins)}–${v.losses}${wr != null ? ` (${wr}%)` : ''}`);
      console.log(`      ${change.slice(0, 160)}`);
    });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
