import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, replays, matches, matchPlayers, replayTeamShares, cardEvents, cards } from '@/lib/schema';
import { getLeaderStats, getLeaderMatchups, getCardStats, getDecks, getDeckMatchups, getResourcingGames } from '@/lib/statsQuery';
import { teamGameIds } from '@/lib/teamSurface';

// B101/P1: the scoping + aggregation layer. These tests double as the privacy
// QA — they pin that personal/team/global never leak into each other, that an
// opted-out uploader is excluded from global, and that min-N gates global rows.

const id = () => randomUUID();
let userA: string;
let userB: string; // opted out of global

async function seedUser(optedOut = false) {
  const uid = id();
  await getDb().insert(users).values({ id: uid, email: `${uid}@e.com`, excludeFromGlobalStats: optedOut });
  return uid;
}

async function seedMatch(opts: {
  gameId: string;
  userId?: string | null;
  format?: string;
  p1: { leader: string; won: boolean; base?: string; rating?: { available: number; wasted: number; forced?: number; underspend?: number; deadCards?: number; countedRounds?: number } };
  p2: { leader: string; won: boolean; base?: string };
  shareTeam?: string;
  // card events to attach: each entry can repeat (copies) to prove the
  // distinct (game,side,card) collapse.
  events?: Array<{ side: 'p1' | 'p2'; cardId: string; event: string; copies?: number }>;
}) {
  const db = getDb();
  const slug = 'r_' + id().slice(0, 8);
  const format = opts.format ?? 'premier';
  await db.insert(replays).values({
    slug, gameId: opts.gameId, userId: opts.userId ?? null, ownerToken: 'kbx_' + id(),
    players: [], payloadBlobUrl: 'memory://x', durationMs: 1,
  });
  await db.insert(matches).values({ gameId: opts.gameId, replaySlug: slug, format, result: 'decisive' });
  await db.insert(matchPlayers).values([
    { gameId: opts.gameId, playerId: 'p1', leader: opts.p1.leader, base: opts.p1.base ?? null, opponentLeader: opts.p2.leader, opponentBase: opts.p2.base ?? null, won: opts.p1.won, isRecorder: true, format,
      resourceAvailable: opts.p1.rating?.available ?? null, resourceWasted: opts.p1.rating?.wasted ?? null, resourceForced: opts.p1.rating?.forced ?? null,
      resourceUnderspend: opts.p1.rating?.underspend ?? null, resourceDeadCards: opts.p1.rating?.deadCards ?? null, resourceCountedRounds: opts.p1.rating?.countedRounds ?? null },
    { gameId: opts.gameId, playerId: 'p2', leader: opts.p2.leader, base: opts.p2.base ?? null, opponentLeader: opts.p1.leader, opponentBase: opts.p1.base ?? null, won: opts.p2.won, isRecorder: false, format },
  ]);
  if (opts.shareTeam) await db.insert(replayTeamShares).values({ replaySlug: slug, teamSlug: opts.shareTeam, sharedBy: opts.userId ?? null });
  if (opts.events?.length) {
    const wonBy = { p1: opts.p1.won, p2: opts.p2.won };
    const rows = opts.events.flatMap((e, i) =>
      Array.from({ length: e.copies ?? 1 }, (_, c) => ({
        gameId: opts.gameId, playerId: e.side, isRecorder: e.side === 'p1', cardId: e.cardId,
        event: e.event, attribution: e.event === 'drawn' || e.event === 'resourced' ? 'recorder' : 'both',
        frameIndex: i * 10 + c, sideWon: wonBy[e.side], format,
      })),
    );
    await db.insert(cardEvents).values(rows);
  }
  return slug;
}

beforeEach(async () => {
  const db = getDb();
  userA = await seedUser(false);
  userB = await seedUser(true); // opted OUT of global
  await db.insert(teams).values({ slug: 'tT', name: 'Team T', createdBy: userA });
  await db.insert(teamMembers).values({ teamSlug: 'tT', userId: userA, role: 'owner' });

  // Base catalog: one ability base (its own deck) + one vanilla aspect base.
  await db.insert(cards).values([
    { cardId: 'B_ABIL', type: 'base', aspects: ['command'], hasAbility: true, name: 'Ability Base' },
    { cardId: 'B_VIG', type: 'base', aspects: ['vigilance'], hasAbility: false, name: 'Vanilla Vigilance' },
  ]);

  // userA: two games, L1 vs L2, 1 win each side. game1 shared with team T.
  // game1 = L1 on the ABILITY base; game2 = L1 on the vanilla vigilance base —
  // so L1 has two distinct decks. p2 is always on the vanilla vigilance base.
  const g1 = 'q-' + id().slice(0, 6);
  // game1 (p1 WON): p1 drew C1 twice (copies) + played C2.
  await seedMatch({
    gameId: g1, userId: userA, p1: { leader: 'L1', won: true, base: 'B_ABIL' }, p2: { leader: 'L2', won: false, base: 'B_VIG' }, shareTeam: 'tT',
    events: [{ side: 'p1', cardId: 'C1', event: 'drawn', copies: 2 }, { side: 'p1', cardId: 'C2', event: 'played' }],
  });
  // game2 (p1 LOST): p1 drew C1 once.
  await seedMatch({
    gameId: 'q-' + id().slice(0, 6), userId: userA, p1: { leader: 'L1', won: false, base: 'B_VIG' }, p2: { leader: 'L2', won: true, base: 'B_VIG' },
    events: [{ side: 'p1', cardId: 'C1', event: 'drawn' }],
  });
  // userB (opted out): L1 wins vs L3 — must NOT appear in global.
  await seedMatch({ gameId: 'q-' + id().slice(0, 6), userId: userB, p1: { leader: 'L1', won: true }, p2: { leader: 'L3', won: false } });
  // anonymous upload: L1 wins vs L3 — included in global (no user to opt out).
  await seedMatch({ gameId: 'q-' + id().slice(0, 6), userId: null, p1: { leader: 'L1', won: true }, p2: { leader: 'L3', won: false } });
});

const byLeader = (rows: { leader: string }[]) => Object.fromEntries(rows.map((r) => [r.leader, r])) as Record<string, any>;

describe('getLeaderStats — scope isolation', () => {
  it('personal = only MY side of my replays (not my opponents’ leaders)', async () => {
    const m = byLeader(await getLeaderStats({ scope: { kind: 'personal', userId: userA } }));
    expect(m.L1.games).toBe(2); // userA played L1 in both games (isRecorder side)
    expect(m.L1.wins).toBe(1);
    expect(m.L1.winRate).toBeCloseTo(0.5);
    // Bug-1 guard: L2 was the OPPONENT's leader — it must NOT be counted as one
    // of userA's own leader stats. (Personal scope = the recorder's row only.)
    expect(m.L2).toBeUndefined();
    expect(m.L3).toBeUndefined();
  });

  // Global/community scope was removed — karabuddy is team-internal only, with
  // no userbase-wide aggregate (see lib/statsQuery). Personal + team only.

  it('team EXTERNAL game = the member’s leader only, never the outsider’s', async () => {
    // game1 (userA vs an outsider, single recorder) is EXTERNAL. Team stats must
    // count userA's leader, NOT the opponent's — the reported conflation: the team
    // didn't play the outsider's leader.
    const sets = await teamGameIds('tT');
    const restrictGameIds = [...sets.internal, ...sets.external];
    const m = byLeader(await getLeaderStats({ scope: { kind: 'team', teamSlug: 'tT', restrictGameIds, internalGameIds: sets.internal } }));
    expect(m.L1.games).toBe(1); // userA's leader on the one shared game
    expect(m.L2).toBeUndefined(); // the OUTSIDER's leader is excluded
  });

  // Bug-2 guard: a co-recorded internal game must count in the team matrix even
  // when the persisted matches.replaySlug is NOT the lexical-min sibling and is
  // itself unshared — as long as ANY sibling is shared. The old slug-based
  // restrict dropped ~half of these (lexical-min vs last-writer-wins disagreed).
  it('counts a co-recorded internal game regardless of which sibling was persisted', async () => {
    const db = getDb();
    const userC = await seedUser(false);
    await db.insert(teamMembers).values({ teamSlug: 'tT', userId: userC, role: 'member' });
    const gid = 'co-' + id().slice(0, 6);
    const slugMin = 'r_aaa' + id().slice(0, 5); // userA's sibling — lexical-min, SHARED
    const slugHi = 'r_zzz' + id().slice(0, 5);  // userC's sibling — lexical-high, NOT shared, persisted LAST
    await db.insert(replays).values([
      { slug: slugMin, gameId: gid, userId: userA, ownerToken: 'kbx_' + id(), players: [], payloadBlobUrl: 'memory://x', durationMs: 1 },
      { slug: slugHi, gameId: gid, userId: userC, ownerToken: 'kbx_' + id(), players: [], payloadBlobUrl: 'memory://x', durationMs: 1 },
    ]);
    await db.insert(replayTeamShares).values({ replaySlug: slugMin, teamSlug: 'tT', sharedBy: userA });
    // matches.replaySlug points at the UNSHARED, non-min sibling (last-writer-wins).
    await db.insert(matches).values({ gameId: gid, replaySlug: slugHi, format: 'premier', result: 'decisive' });
    await db.insert(matchPlayers).values([
      { gameId: gid, playerId: 'p1', leader: 'LX', opponentLeader: 'LY', won: true, isRecorder: true, format: 'premier' },
      { gameId: gid, playerId: 'p2', leader: 'LY', opponentLeader: 'LX', won: false, isRecorder: false, format: 'premier' },
    ]);
    const sets = await teamGameIds('tT');
    expect(sets.internal).toContain(gid); // 2 member recorders + a shared sibling
    const scope = { kind: 'team' as const, teamSlug: 'tT', restrictGameIds: sets.internal, internalGameIds: sets.internal };
    const rows = await getLeaderMatchups({ scope });
    expect(rows.find((r) => r.leader === 'LX' && r.opponentLeader === 'LY')).toMatchObject({ games: 1, wins: 1 });
    expect(rows.find((r) => r.leader === 'LY' && r.opponentLeader === 'LX')).toMatchObject({ games: 1, wins: 0 });
    // INTERNAL game: BOTH teammates' leaders count (it's a team aggregate, and both
    // players are members) — so the opponent-exclusion above is external-only.
    const m = byLeader(await getLeaderStats({ scope }));
    expect(m.LX?.games).toBe(1);
    expect(m.LY?.games).toBe(1);
  });
});

describe('getCardStats', () => {
  it('win-rate-when-drawn: collapses copies to one (game,side) observation', async () => {
    const rows = await getCardStats({ scope: { kind: 'personal', userId: userA }, event: 'drawn' });
    const c1 = rows.find((r) => r.cardId === 'C1')!;
    // 2 games (game1 won, game2 lost) — NOT 3, despite 2 copies drawn in game1.
    expect(c1.observations).toBe(2);
    expect(c1.wins).toBe(1);
    expect(c1.winRate).toBeCloseTo(0.5);
    // C2 was played, not drawn → absent from the drawn query.
    expect(rows.find((r) => r.cardId === 'C2')).toBeUndefined();
  });

  it('filters by event — played picks up C2 only', async () => {
    const rows = await getCardStats({ scope: { kind: 'personal', userId: userA }, event: 'played' });
    expect(rows.map((r) => r.cardId)).toEqual(['C2']);
    expect(rows[0].observations).toBe(1);
    expect(rows[0].wins).toBe(1);
  });

  it('scopes to a leader/deck context — only events from that leader-side count', async () => {
    // p1 (the event side) was on L1 in both userA games; C1 was drawn by p1.
    const onL1 = await getCardStats({ scope: { kind: 'personal', userId: userA }, event: 'drawn', leader: 'L1' });
    expect(onL1.find((r) => r.cardId === 'C1')?.observations).toBe(2);
    // No events come from an L2-side, so an L2 context is empty for C1.
    const onL2 = await getCardStats({ scope: { kind: 'personal', userId: userA }, event: 'drawn', leader: 'L2' });
    expect(onL2.find((r) => r.cardId === 'C1')).toBeUndefined();
  });

  it('base context: ability base vs vanilla aspect partition the same leader', async () => {
    const scope = { kind: 'personal', userId: userA } as const;
    // C1 was drawn in BOTH L1 games (ability-base game won, vanilla-base game lost).
    // Ability-base deck → only game1 (the win).
    const onAbil = await getCardStats({ scope, event: 'drawn', leader: 'L1', baseId: 'B_ABIL' });
    expect(onAbil.find((r) => r.cardId === 'C1')).toMatchObject({ observations: 1, wins: 1 });
    // Vanilla vigilance deck → only game2 (the loss).
    const onVanilla = await getCardStats({ scope, event: 'drawn', leader: 'L1', baseAspect: 'vigilance' });
    expect(onVanilla.find((r) => r.cardId === 'C1')).toMatchObject({ observations: 1, wins: 0 });
    // The ability base is NOT swept into its own aspect (command) vanilla bucket.
    const onCmdVanilla = await getCardStats({ scope, event: 'drawn', leader: 'L1', baseAspect: 'command' });
    expect(onCmdVanilla.find((r) => r.cardId === 'C1')).toBeUndefined();
  });
});

describe('getDecks', () => {
  it('lists a leader’s decks: ability base as itself, vanilla base as its aspect', async () => {
    const decks = await getDecks({ scope: { kind: 'personal', userId: userA }, leader: 'L1' });
    const abil = decks.find((d) => d.baseId === 'B_ABIL');
    const vanilla = decks.find((d) => d.baseAspect === 'vigilance' && !d.baseId);
    expect(abil).toMatchObject({ leader: 'L1', baseAspect: null, games: 1, wins: 1 });
    expect(vanilla).toMatchObject({ leader: 'L1', baseId: null, games: 1, wins: 0 });
    expect(decks).toHaveLength(2);
  });
});

describe('getDeckMatchups', () => {
  it('splits one leader matchup into per-deck rows', async () => {
    const rows = await getDeckMatchups({ scope: { kind: 'personal', userId: userA } });
    // Both userA decks faced L2-on-vanilla-vigilance, once each.
    const abilVsL2 = rows.find((r) => r.leader === 'L1' && r.baseId === 'B_ABIL' && r.opponentLeader === 'L2');
    const vigVsL2 = rows.find((r) => r.leader === 'L1' && r.baseAspect === 'vigilance' && !r.baseId && r.opponentLeader === 'L2');
    expect(abilVsL2).toMatchObject({ games: 1, wins: 1, opponentBaseAspect: 'vigilance', opponentBaseId: null });
    expect(vigVsL2).toMatchObject({ games: 1, wins: 0, opponentBaseAspect: 'vigilance' });
  });
});

describe('getResourcingGames', () => {
  it('returns rated recorder games in scope, with deck + components', async () => {
    await seedMatch({
      gameId: 'res-' + id().slice(0, 6), userId: userA,
      p1: { leader: 'L1', won: true, base: 'B_ABIL', rating: { available: 20, wasted: 4, forced: 1, underspend: 3, deadCards: 2, countedRounds: 5 } },
      p2: { leader: 'L2', won: false },
    });
    const rows = await getResourcingGames({ scope: { kind: 'personal', userId: userA } });
    // Only the rated game comes back (the beforeEach games have null ratings).
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ leader: 'L1', baseId: 'B_ABIL', available: 20, wasted: 4, deadCards: 2 });
    expect(rows[0].createdAt).toBeTruthy();
  });

  it('excludes a different user’s games (scope isolation)', async () => {
    await seedMatch({
      gameId: 'res-' + id().slice(0, 6), userId: userB,
      p1: { leader: 'L1', won: true, rating: { available: 10, wasted: 1 } }, p2: { leader: 'L3', won: false },
    });
    const mine = await getResourcingGames({ scope: { kind: 'personal', userId: userA } });
    expect(mine).toHaveLength(0); // userA has no rated games of their own here
  });
});

describe('getLeaderMatchups', () => {
  it('produces a directed matchup row with win rate (personal)', async () => {
    const rows = await getLeaderMatchups({ scope: { kind: 'personal', userId: userA } });
    const l1vL2 = rows.find((r) => r.leader === 'L1' && r.opponentLeader === 'L2')!;
    expect(l1vL2.games).toBe(2);
    expect(l1vL2.wins).toBe(1);
    expect(l1vL2.winRate).toBeCloseTo(0.5);
  });
});
