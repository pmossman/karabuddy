// PROTOTYPE (throwaway, exploration-first — swuforge migration kickoff step 2).
// "Given a user, produce their deduped archetype decklists in the community-
// standard SWUDB deck JSON shape." Pure derivation, on our side, de-risks the
// handoff before we agree a wire format with the swuforge dev. Reuses the
// leader-identity + base-functional-identity clustering from buildArchetypes
// (lib/sideboardGuides.teamMatchupOptions), scoped to ONE user instead of a team.
//
// LOCAL ONLY. Loads .env.development.local exclusively (pg @ localhost:5434, the
// prod snapshot) — never prod. Read-only.
//
//   npx tsx scripts/prototype-user-deck-export.ts [userId] [--json=<path>]
//   npx tsx scripts/prototype-user-deck-export.ts --top          # list top users by qualifying replays
//
// If no userId is given, auto-picks the user with the most qualifying replays.

import { config } from 'dotenv';
config({ path: '.env.development.local' }); // local snapshot ONLY — do not add .env.local

const CARD = (set: string, number: number | string) => {
  const n = Number(number);
  const num = Number.isFinite(n) ? String(n).padStart(3, '0') : String(number);
  return `${set}_${num}`;
};

// A representative decklist for one archetype the user has played.
interface DerivedDeck {
  key: string; // archetype dedup key: leaderValue | baseIdentity.key
  leaderLabel: string;
  baseLabel: string;
  games: number; // # of the user's replays in this archetype
  repSlug: string; // the replay the representative list came from
  repDate: string;
  swudb: SwudbDeck; // the exportable list (latest game of the archetype)
  deckTotal: number; // card counts, for completeness eyeballing (should be ~50 / ~10)
  sideTotal: number;
}

interface SwudbDeck {
  metadata: { name: string; source: string };
  leader: { id: string; count: 1 };
  base: { id: string; count: 1 };
  deck: Array<{ id: string; count: number }>;
  sideboard: Array<{ id: string; count: number }>;
}

async function main() {
  const { getDb } = await import('../lib/db');
  const { replays, extensionTokens, users, cards } = await import('../lib/schema');
  const { and, eq, or, inArray, isNotNull } = await import('drizzle-orm');
  const { resolveBaseIdentities } = await import('../lib/baseIdentity');
  const { leaderValue } = await import('../lib/sideboardGuides');
  const db = getDb();

  const args = process.argv.slice(2);
  const jsonArg = args.find((a) => a.startsWith('--json='))?.split('=')[1];
  const wantTop = args.includes('--top');
  let userId = args.find((a) => !a.startsWith('--')) || null;

  // A replay "qualifies" for deck export iff: not encrypted (server can decode),
  // has decks + an ownerPlayerId (so we know WHICH POV is the unmasked list).
  const qualifies = and(eq(replays.encrypted, false), isNotNull(replays.decks), isNotNull(replays.ownerPlayerId));

  // --- Scope resolution: userId + ALL their claimed install tokens ------------
  // (Mirrors the export scope the kickoff specifies: session user + every device.)
  async function scopeReplays(uid: string) {
    const tokenRows = await db.select({ token: extensionTokens.token }).from(extensionTokens).where(eq(extensionTokens.userId, uid));
    const tokens = tokenRows.map((r) => r.token);
    const ownerFilter = tokens.length ? or(eq(replays.userId, uid), inArray(replays.ownerToken, tokens)) : eq(replays.userId, uid);
    return db
      .select({ slug: replays.slug, players: replays.players, decks: replays.decks, ownerPlayerId: replays.ownerPlayerId, createdAt: replays.createdAt })
      .from(replays)
      .where(and(ownerFilter, qualifies));
  }

  if (wantTop || !userId) {
    // Rank users by qualifying replay count (userId path only — good enough to pick a demo).
    const rows = await db.select({ userId: replays.userId }).from(replays).where(and(qualifies, isNotNull(replays.userId)));
    const counts = new Map<string, number>();
    for (const r of rows) if (r.userId) counts.set(r.userId, (counts.get(r.userId) || 0) + 1);
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const nameRows = ranked.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ranked.map((r) => r[0]))) : [];
    const nameOf = new Map(nameRows.map((n) => [n.id, n.name]));
    console.log('\nTop users by qualifying (decodable, own-POV, has-decks) replays:');
    for (const [uid, c] of ranked) console.log(`  ${c.toString().padStart(4)}  ${uid}  ${nameOf.get(uid) ?? '(no name)'}`);
    if (wantTop) return;
    userId = ranked[0]?.[0] ?? null;
    if (!userId) { console.log('\nNo qualifying users in the snapshot.'); return; }
    console.log(`\nAuto-picked top user: ${userId} (${nameOf.get(userId) ?? 'no name'})\n`);
  }

  const rows = await scopeReplays(userId!);
  if (!rows.length) { console.log(`No qualifying replays for user ${userId}.`); return; }

  // --- Base functional identities (collapse reprints / force-pairs) -----------
  const baseRefs = rows
    .map((r) => (Array.isArray(r.players) ? (r.players as any[]).find((p) => p?.id === r.ownerPlayerId)?.base : null))
    .filter(Boolean);
  const baseIds = await resolveBaseIdentities(baseRefs as any);

  // --- Leader subtitles (name·subtitle identity; multiple "Luke Skywalker"s) --
  const leaderCards = await db.select({ set: cards.set, number: cards.number, subtitle: cards.subtitle }).from(cards).where(eq(cards.type, 'leader'));
  const subMap = new Map(leaderCards.map((c) => [`${c.set}|${c.number}`, c.subtitle ?? null]));

  // --- Cluster the user's replays by archetype; keep the LATEST list per key ---
  const byKey = new Map<string, DerivedDeck & { repTime: number }>();
  for (const r of rows) {
    const owner = Array.isArray(r.players) ? (r.players as any[]).find((p) => p?.id === r.ownerPlayerId) : null;
    if (!owner?.leader?.name || !owner?.base) continue;
    const deckObj = (r.decks as any)?.[r.ownerPlayerId!];
    if (!deckObj) continue;

    const subtitle = subMap.get(`${owner.leader.set}|${owner.leader.number}`) ?? null;
    const lv = leaderValue(owner.leader.name, subtitle);
    const baseId = baseIds.get(CARD(owner.base.set, owner.base.number));
    const baseKey = baseId?.key ?? `name:${owner.base.name}`;
    const key = `${lv}|${baseKey}`;
    const t = new Date(r.createdAt as any).getTime();

    const deck = (deckObj.deck || []).map((c: any) => ({ id: c.id, count: c.count }));
    const sideboard = (deckObj.sideboard || []).map((c: any) => ({ id: c.id, count: c.count }));
    const deckTotal = deck.reduce((s: number, c: any) => s + (c.count || 0), 0);
    const sideTotal = sideboard.reduce((s: number, c: any) => s + (c.count || 0), 0);

    // Representative selection: a maindeck is legal at ≥50 cards. Prefer a
    // COMPLETE recent list over a fresher-but-partial one (nextSet/mid-build
    // captures land as 30-card fragments). Tie-break complete-vs-complete by
    // recency; if the archetype has NO complete list, keep the biggest.
    const complete = deckTotal >= 50;
    const existing = byKey.get(key);
    if (existing) {
      existing.games++;
      const existingComplete = existing.deckTotal >= 50;
      const better = complete && !existingComplete
        ? true
        : complete === existingComplete
          ? (complete ? t > existing.repTime : deckTotal > existing.deckTotal)
          : false;
      if (!better) continue;
    }
    const leaderLabel = subtitle ? `${owner.leader.name} · ${subtitle}` : owner.leader.name;
    const baseLabel = baseId?.label ?? owner.base.name ?? '(unknown base)';

    byKey.set(key, {
      key,
      leaderLabel,
      baseLabel,
      games: existing ? existing.games : 1,
      repSlug: r.slug,
      repDate: new Date(r.createdAt as any).toISOString().slice(0, 10),
      repTime: t,
      deckTotal,
      sideTotal,
      swudb: {
        metadata: { name: `${leaderLabel} — ${baseLabel}`, source: 'karabuddy' },
        leader: { id: CARD(owner.leader.set, owner.leader.number), count: 1 },
        base: { id: CARD(owner.base.set, owner.base.number), count: 1 },
        deck,
        sideboard,
      },
    });
  }

  const derived: DerivedDeck[] = [...byKey.values()]
    .map(({ repTime, ...d }) => d)
    .sort((a, b) => b.games - a.games || b.deckTotal - a.deckTotal);

  // --- Report -----------------------------------------------------------------
  console.log(`User ${userId}: ${rows.length} qualifying replays → ${derived.length} deduped archetype decks\n`);
  console.log('  games  cards+sb   latest       archetype');
  console.log('  -----  --------   ----------   ----------------------------------');
  for (const d of derived) {
    const completeness = d.deckTotal < 45 || d.sideTotal > 12 ? ' ⚠' : '';
    console.log(`  ${d.games.toString().padStart(5)}  ${(d.deckTotal + '+' + d.sideTotal).padStart(8)}${completeness}   ${d.repDate}   ${d.leaderLabel} — ${d.baseLabel}  [${d.repSlug}]`);
  }

  const bundle = { userId, generatedFrom: `${rows.length} replays`, decks: derived.map((d) => d.swudb) };
  const outPath = jsonArg || `/private/tmp/claude-501/-Users-parker-code-karabuddy/80c7818e-be24-4ca7-98d0-e8717f134146/scratchpad/deck-export-${userId}.json`;
  const { writeFileSync } = await import('node:fs');
  writeFileSync(outPath, JSON.stringify(bundle, null, 2));
  console.log(`\nFull SWUDB-shape bundle → ${outPath}`);
  console.log('\nSample (top archetype, first 6 deck cards):');
  console.log(JSON.stringify({ ...derived[0]?.swudb, deck: derived[0]?.swudb.deck.slice(0, 6) }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
