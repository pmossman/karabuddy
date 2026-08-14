import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, replays, matches, matchPlayers, replayTeamShares, cardEvents, cards } from '@/lib/schema';
import { getLeaderStats, getLeaderMatchups, getCardStats, getDecks, getDeckMatchups, getResourcingGames, getEntityReplays } from '@/lib/statsQuery';
import { teamGameIds } from '@/lib/teamSurface';

// B101/P1: the scoping + aggregation layer. These tests double as the privacy
// QA — they pin that personal and team scopes never leak into each other.

const id = () => randomUUID();
let userA: string;
let userB: string; // a second, unrelated user — for scope-isolation checks

async function seedUser(optedOut = false) {
  const uid = id();
  await getDb().insert(users).values({ id: uid, email: `${uid}@e.com`, excludeFromGlobalStats: optedOut });
  return uid;
}

async function seedMatch(opts: {
  gameId: string;
  userId?: string | null;
  ownerPlayerId?: string | null; // recorder's seat; null = legacy pre-B59 row
  format?: string;
  p1: { leader: string; won: boolean; base?: string; rating?: { available: number; wasted: number; forced?: number; underspend?: number; deadCards?: number; countedRounds?: number } };
  p2: { leader: string; won: boolean; base?: string };
  shareTeam?: string;
  createdAt?: Date; // match date — for the time-window tests
  // card events to attach: each entry can repeat (copies) to prove the
  // distinct (game,side,card) collapse.
  events?: Array<{ side: 'p1' | 'p2'; cardId: string; event: string; copies?: number }>;
}) {
  const db = getDb();
  const slug = 'r_' + id().slice(0, 8);
  const format = opts.format ?? 'premier';
  await db.insert(replays).values({
    slug, gameId: opts.gameId, userId: opts.userId ?? null, ownerToken: 'kbx_' + id(),
    // The recorder's seat. Personal scope is seat-based (B233), so this is what
    // ties the fact rows to the uploader — mirrors what the upload route stores.
    ownerPlayerId: opts.ownerPlayerId === undefined ? 'p1' : opts.ownerPlayerId,
    players: [], payloadBlobUrl: 'memory://x', durationMs: 1,
  });
  await db.insert(matches).values({ gameId: opts.gameId, replaySlug: slug, format, result: 'decisive', ...(opts.createdAt ? { createdAt: opts.createdAt } : {}) });
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
  userB = await seedUser(false);
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

// B233 guards. Personal scope used to resolve "my games" through the single
// matches.replaySlug + match_players.isRecorder — both of which name whichever
// sibling was persisted LAST. When your opponent also records and uploads after
// you, that pair points at THEM, so your own game silently left your stats while
// still listing in /replays (the reported symptom: 186 replays vs 174 stats).
// Scope is now seat-based: your replay row's ownerPlayerId picks your side.
describe('personal scope — co-recorded games (B233)', () => {
  // A game both players recorded. `persistedBy` decides which sibling won the
  // last-writer-wins race for matches.replaySlug + the isRecorder flag.
  async function seedCoRecorded(opts: {
    gameId: string; meUser: string; themUser: string;
    persistedBy: 'me' | 'them';
    myLeader: string; theirLeader: string; iWon: boolean;
    myOwnerPlayerId?: string | null;
    events?: Array<{ side: 'p1' | 'p2'; cardId: string; event: string }>;
  }) {
    const db = getDb();
    const mySlug = 'r_me' + id().slice(0, 6);
    const theirSlug = 'r_th' + id().slice(0, 6);
    await db.insert(replays).values([
      { slug: mySlug, gameId: opts.gameId, userId: opts.meUser, ownerToken: 'kbx_' + id(),
        ownerPlayerId: opts.myOwnerPlayerId === undefined ? 'p1' : opts.myOwnerPlayerId,
        players: [], payloadBlobUrl: 'memory://x', durationMs: 1 },
      { slug: theirSlug, gameId: opts.gameId, userId: opts.themUser, ownerToken: 'kbx_' + id(),
        ownerPlayerId: 'p2', players: [], payloadBlobUrl: 'memory://x', durationMs: 1 },
    ]);
    const persisted = opts.persistedBy === 'me' ? mySlug : theirSlug;
    await db.insert(matches).values({ gameId: opts.gameId, replaySlug: persisted, format: 'premier', result: 'decisive' });
    // isRecorder follows the persisted sibling — that's the whole trap.
    const meIsRecorder = opts.persistedBy === 'me';
    await db.insert(matchPlayers).values([
      { gameId: opts.gameId, playerId: 'p1', leader: opts.myLeader, opponentLeader: opts.theirLeader, won: opts.iWon, isRecorder: meIsRecorder, format: 'premier' },
      { gameId: opts.gameId, playerId: 'p2', leader: opts.theirLeader, opponentLeader: opts.myLeader, won: !opts.iWon, isRecorder: !meIsRecorder, format: 'premier' },
    ]);
    if (opts.events?.length) {
      const wonBy = { p1: opts.iWon, p2: !opts.iWon };
      await db.insert(cardEvents).values(opts.events.map((e, i) => ({
        gameId: opts.gameId, playerId: e.side, isRecorder: e.side === 'p1' ? meIsRecorder : !meIsRecorder,
        cardId: e.cardId, event: e.event,
        attribution: e.event === 'drawn' || e.event === 'resourced' ? 'recorder' : 'both',
        frameIndex: i, sideWon: wonBy[e.side], format: 'premier',
      })));
    }
    return { mySlug, theirSlug };
  }

  it('counts my game when MY opponent’s sibling was persisted last', async () => {
    const them = await seedUser(false);
    await seedCoRecorded({ gameId: 'cr-' + id().slice(0, 6), meUser: userA, themUser: them, persistedBy: 'them', myLeader: 'L1', theirLeader: 'L9', iWon: true });
    const m = byLeader(await getLeaderStats({ scope: { kind: 'personal', userId: userA } }));
    expect(m.L1.games).toBe(3); // the 2 seeded solo games + this co-recorded one
    expect(m.L9).toBeUndefined(); // …and their leader is still not mine
  });

  it('counts the SAME game for both recorders, from each one’s own side', async () => {
    const them = await seedUser(false);
    await seedCoRecorded({ gameId: 'cr-' + id().slice(0, 6), meUser: userA, themUser: them, persistedBy: 'them', myLeader: 'LM', theirLeader: 'LT', iWon: true });
    const mine = byLeader(await getLeaderStats({ scope: { kind: 'personal', userId: userA } }));
    const theirs = byLeader(await getLeaderStats({ scope: { kind: 'personal', userId: them } }));
    expect(mine.LM).toMatchObject({ games: 1, wins: 1 });
    expect(theirs.LT).toMatchObject({ games: 1, wins: 0 });
    expect(mine.LT).toBeUndefined();
    expect(theirs.LM).toBeUndefined();
  });

  // The bug was never "just a count": the recovered games carry results, so every
  // derived number moved with them. Here the dropped game is the only LOSS.
  it('win rate reflects the recovered games, not just the total', async () => {
    const them = await seedUser(false);
    const gid = () => 'cr-' + id().slice(0, 6);
    // Persisted by me → always counted, a WIN.
    await seedCoRecorded({ gameId: gid(), meUser: userA, themUser: them, persistedBy: 'me', myLeader: 'LW', theirLeader: 'LT', iWon: true });
    // Persisted by them → used to vanish. Both are LOSSES.
    await seedCoRecorded({ gameId: gid(), meUser: userA, themUser: them, persistedBy: 'them', myLeader: 'LW', theirLeader: 'LT', iWon: false });
    await seedCoRecorded({ gameId: gid(), meUser: userA, themUser: them, persistedBy: 'them', myLeader: 'LW', theirLeader: 'LT', iWon: false });
    const m = byLeader(await getLeaderStats({ scope: { kind: 'personal', userId: userA } }));
    // Pre-fix this read 1 game / 100% win rate. The truth is 1-of-3.
    expect(m.LW).toMatchObject({ games: 3, wins: 1, decisive: 3 });
    expect(m.LW.winRate).toBeCloseTo(1 / 3);
  });

  it('matchup cells recover the missing games too', async () => {
    const them = await seedUser(false);
    await seedCoRecorded({ gameId: 'cr-' + id().slice(0, 6), meUser: userA, themUser: them, persistedBy: 'them', myLeader: 'LX', theirLeader: 'LY', iWon: false });
    const rows = await getLeaderMatchups({ scope: { kind: 'personal', userId: userA }, leader: 'LX' });
    expect(rows.find((r) => r.leader === 'LX' && r.opponentLeader === 'LY')).toMatchObject({ games: 1, wins: 0 });
  });

  it('card stats pick up MY side of a game my opponent persisted', async () => {
    const them = await seedUser(false);
    await seedCoRecorded({
      gameId: 'cr-' + id().slice(0, 6), meUser: userA, themUser: them, persistedBy: 'them',
      myLeader: 'LC', theirLeader: 'LD', iWon: true,
      events: [{ side: 'p1', cardId: 'MINE', event: 'played' }, { side: 'p2', cardId: 'THEIRS', event: 'played' }],
    });
    const rows = await getCardStats({ scope: { kind: 'personal', userId: userA }, event: 'played' });
    const byCard = Object.fromEntries(rows.map((r) => [r.cardId, r]));
    expect(byCard.MINE).toMatchObject({ observations: 1, wins: 1 });
    // Their play is still theirs — recovering my side must not leak the opponent's.
    expect(byCard.THEIRS).toBeUndefined();
  });

  it('drill-in lists MY replay slug for a game my opponent persisted', async () => {
    const them = await seedUser(false);
    const { mySlug, theirSlug } = await seedCoRecorded({ gameId: 'cr-' + id().slice(0, 6), meUser: userA, themUser: them, persistedBy: 'them', myLeader: 'LR', theirLeader: 'LS', iWon: true });
    const rows = await getEntityReplays({ scope: { kind: 'personal', userId: userA }, leader: 'LR' });
    expect(rows.map((r) => r.slug)).toEqual([mySlug]);
    expect(rows.map((r) => r.slug)).not.toContain(theirSlug);
  });

  // A user can hold TWO replay rows for one game+seat (upload dedupes per
  // (gameId, ownerToken), so a second install mints a second row). The seat join
  // must not fan out and count that game twice.
  it('does not double-count when I hold two replay rows for the same game', async () => {
    const db = getDb();
    const gid = 'dup-' + id().slice(0, 6);
    const slugs = ['r_d1' + id().slice(0, 6), 'r_d2' + id().slice(0, 6)];
    await db.insert(replays).values(slugs.map((slug) => ({
      slug, gameId: gid, userId: userA, ownerToken: 'kbx_' + id(), ownerPlayerId: 'p1',
      players: [], payloadBlobUrl: 'memory://x', durationMs: 1,
    })));
    await db.insert(matches).values({ gameId: gid, replaySlug: slugs[0], format: 'premier', result: 'decisive' });
    await db.insert(matchPlayers).values([
      { gameId: gid, playerId: 'p1', leader: 'LDUP', opponentLeader: 'LZ', won: true, isRecorder: true, format: 'premier' },
      { gameId: gid, playerId: 'p2', leader: 'LZ', opponentLeader: 'LDUP', won: false, isRecorder: false, format: 'premier' },
    ]);
    const m = byLeader(await getLeaderStats({ scope: { kind: 'personal', userId: userA } }));
    expect(m.LDUP.games).toBe(1);
    const rows = await getEntityReplays({ scope: { kind: 'personal', userId: userA }, leader: 'LDUP' });
    expect(rows).toHaveLength(1);
  });

  // Pre-B59 / anonymous-claimed rows have no ownerPlayerId and can't be
  // seat-matched — they fall back to the old slug + isRecorder pair, so the fix
  // can only ever add games back, never take one away.
  it('still counts a legacy replay row with no ownerPlayerId', async () => {
    await seedMatch({
      gameId: 'legacy-' + id().slice(0, 6), userId: userA, ownerPlayerId: null,
      p1: { leader: 'LLEG', won: true }, p2: { leader: 'LZ', won: false },
    });
    const m = byLeader(await getLeaderStats({ scope: { kind: 'personal', userId: userA } }));
    expect(m.LLEG).toMatchObject({ games: 1, wins: 1 });
    expect(m.LZ).toBeUndefined();
  });

  it('still excludes another user’s games entirely', async () => {
    await seedMatch({ gameId: 'other-' + id().slice(0, 6), userId: userB, p1: { leader: 'LOTHER', won: true }, p2: { leader: 'LZ', won: false } });
    const m = byLeader(await getLeaderStats({ scope: { kind: 'personal', userId: userA } }));
    expect(m.LOTHER).toBeUndefined();
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

  // Perspective by scope for BOARD-VISIBLE events (played/discarded are
  // attribution 'both' → materialized for BOTH sides). The audience boundary
  // must drop the wrong side, exactly like the leader matrix (cardPerspectiveCond).
  describe('perspective by scope (played is two-sided)', () => {
    it('personal counts only YOUR play, not the opponent’s board play', async () => {
      await seedMatch({
        gameId: 'pp-' + id().slice(0, 6), userId: userA,
        p1: { leader: 'LM', won: true }, p2: { leader: 'LO', won: false },
        events: [{ side: 'p1', cardId: 'PM', event: 'played' }, { side: 'p2', cardId: 'PO', event: 'played' }],
      });
      const ids = (await getCardStats({ scope: { kind: 'personal', userId: userA }, event: 'played' })).map((r) => r.cardId);
      expect(ids).toContain('PM');
      expect(ids).not.toContain('PO'); // the opponent's play is not "a card YOU played"
    });

    it('team EXTERNAL game counts the member’s play, never the outsider’s', async () => {
      // userA (member) vs an outsider, shared with tT → EXTERNAL (single recorder).
      await seedMatch({
        gameId: 'ext-' + id().slice(0, 6), userId: userA, shareTeam: 'tT',
        p1: { leader: 'LM', won: true }, p2: { leader: 'LO', won: false },
        events: [{ side: 'p1', cardId: 'CM', event: 'played' }, { side: 'p2', cardId: 'CO', event: 'played' }],
      });
      const sets = await teamGameIds('tT');
      const scope = { kind: 'team' as const, teamSlug: 'tT', restrictGameIds: [...sets.internal, ...sets.external], internalGameIds: sets.internal };
      const ids = (await getCardStats({ scope, event: 'played' })).map((r) => r.cardId);
      expect(ids).toContain('CM');
      expect(ids).not.toContain('CO'); // the OUTSIDER's play must not leak into team stats
    });

    it('team INTERNAL game counts BOTH teammates’ plays (the non-recorder side too)', async () => {
      const db = getDb();
      const userC = await seedUser(false);
      await db.insert(teamMembers).values({ teamSlug: 'tT', userId: userC, role: 'member' });
      const gid = 'cint-' + id().slice(0, 6);
      const slugA = 'r_aaa' + id().slice(0, 5);
      const slugC = 'r_zzz' + id().slice(0, 5);
      await db.insert(replays).values([
        { slug: slugA, gameId: gid, userId: userA, ownerToken: 'kbx_' + id(), players: [], payloadBlobUrl: 'memory://x', durationMs: 1 },
        { slug: slugC, gameId: gid, userId: userC, ownerToken: 'kbx_' + id(), players: [], payloadBlobUrl: 'memory://x', durationMs: 1 },
      ]);
      await db.insert(replayTeamShares).values({ replaySlug: slugA, teamSlug: 'tT', sharedBy: userA });
      await db.insert(matches).values({ gameId: gid, replaySlug: slugA, format: 'premier', result: 'decisive' });
      await db.insert(matchPlayers).values([
        { gameId: gid, playerId: 'p1', leader: 'LX', opponentLeader: 'LY', won: true, isRecorder: true, format: 'premier' },
        { gameId: gid, playerId: 'p2', leader: 'LY', opponentLeader: 'LX', won: false, isRecorder: false, format: 'premier' },
      ]);
      await db.insert(cardEvents).values([
        { gameId: gid, playerId: 'p1', isRecorder: true, cardId: 'IA', event: 'played', attribution: 'both', frameIndex: 1, sideWon: true, format: 'premier' },
        { gameId: gid, playerId: 'p2', isRecorder: false, cardId: 'IB', event: 'played', attribution: 'both', frameIndex: 2, sideWon: false, format: 'premier' },
      ]);
      const sets = await teamGameIds('tT');
      expect(sets.internal).toContain(gid);
      const scope = { kind: 'team' as const, teamSlug: 'tT', restrictGameIds: sets.internal, internalGameIds: sets.internal };
      const ids = (await getCardStats({ scope, event: 'played' })).map((r) => r.cardId);
      expect(ids).toContain('IA'); // recorder side
      expect(ids).toContain('IB'); // teammate (non-recorder) side counts in an internal game
    });
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

// B194 drill-in: a leader's matchup breakdown (getLeaderMatchups filtered to one
// leader / leader+base) + the recorder's recent replays on that leader/deck
// (getEntityReplays). Backs the Leaders-row → detail-view drill-in.
describe('B194 drill-in producers', () => {
  let u: string;
  beforeEach(async () => {
    u = await seedUser(false);
    // All recorder-side (p1) games for u on L1, plus a different leader + an
    // opponent-side L1 game that must NOT count as "my L1 games".
    await seedMatch({ gameId: 'd1', userId: u, p1: { leader: 'L1', won: true,  base: 'BA' }, p2: { leader: 'L2', won: false } });
    await seedMatch({ gameId: 'd2', userId: u, p1: { leader: 'L1', won: false, base: 'BA' }, p2: { leader: 'L3', won: true  } });
    await seedMatch({ gameId: 'd3', userId: u, p1: { leader: 'L1', won: true,  base: 'BB' }, p2: { leader: 'L2', won: false } });
    await seedMatch({ gameId: 'd4', userId: u, p1: { leader: 'L9', won: true,  base: 'BA' }, p2: { leader: 'L2', won: false } }); // different leader
    await seedMatch({ gameId: 'd5', userId: u, p1: { leader: 'L7', won: true }, p2: { leader: 'L1', won: false } }); // L1 is the OPPONENT here
  });
  const scope = () => ({ kind: 'personal' as const, userId: u });

  it('getLeaderMatchups(leader) returns only that leader’s directed rows', async () => {
    const rows = await getLeaderMatchups({ scope: scope(), leader: 'L1' });
    expect(rows.every((r) => r.leader === 'L1')).toBe(true);
    const vL2 = rows.find((r) => r.opponentLeader === 'L2')!;
    const vL3 = rows.find((r) => r.opponentLeader === 'L3')!;
    expect(vL2).toMatchObject({ games: 2, wins: 2 }); // d1 + d3
    expect(vL3).toMatchObject({ games: 1, wins: 0 }); // d2
    expect(rows.find((r) => r.leader === 'L9')).toBeUndefined();
  });

  it('getLeaderMatchups(leader, baseId) scopes to that deck', async () => {
    const rows = await getLeaderMatchups({ scope: scope(), leader: 'L1', baseId: 'BA' });
    // Only BA games (d1 vs L2, d2 vs L3); d3 is base BB → excluded.
    expect(rows.find((r) => r.opponentLeader === 'L2')).toMatchObject({ games: 1, wins: 1 });
    expect(rows.find((r) => r.opponentLeader === 'L3')).toMatchObject({ games: 1, wins: 0 });
  });

  it('getEntityReplays(leader) = the recorder’s replays on that leader, newest first', async () => {
    const rows = await getEntityReplays({ scope: scope(), leader: 'L1' });
    expect(rows).toHaveLength(3); // d1, d2, d3 — NOT d4 (L9) and NOT d5 (L1 is opponent)
    expect(rows.every((r) => typeof r.slug === 'string')).toBe(true);
    // won reflects the recorder's result
    expect(rows.filter((r) => r.won === true)).toHaveLength(2);
  });

  it('getEntityReplays(leader, baseId) scopes to the deck', async () => {
    const rows = await getEntityReplays({ scope: scope(), leader: 'L1', baseId: 'BB' });
    expect(rows).toHaveLength(1); // d3 only
  });

  it('getEntityReplays excludes games where the leader was the OPPONENT (my side only)', async () => {
    const rows = await getEntityReplays({ scope: scope(), leader: 'L7' });
    expect(rows).toHaveLength(1); // d5 — recorder played L7
    const asOpp = await getEntityReplays({ scope: scope(), leader: 'L1' });
    expect(asOpp.find((r) => r.gameId === 'd5')).toBeUndefined();
  });
  it('time window (from/to over matches.createdAt) filters aggregation', async () => {
    const scope = { kind: 'personal' as const, userId: userA };
    await seedMatch({ gameId: id(), userId: userA, createdAt: new Date('2026-05-10T00:00:00Z'), p1: { leader: 'MAY_L', won: true }, p2: { leader: 'X', won: false } });
    await seedMatch({ gameId: id(), userId: userA, createdAt: new Date('2026-06-20T00:00:00Z'), p1: { leader: 'JUN_L', won: true }, p2: { leader: 'X', won: false } });

    const all = await getLeaderStats({ scope, minGames: 1 });
    expect(all.find((r) => r.leader === 'MAY_L')).toBeTruthy();
    expect(all.find((r) => r.leader === 'JUN_L')).toBeTruthy();

    // A June window drops the May game.
    const june = await getLeaderStats({ scope, from: new Date('2026-06-01T00:00:00Z'), to: new Date('2026-06-30T23:59:59Z'), minGames: 1 });
    expect(june.find((r) => r.leader === 'MAY_L')).toBeUndefined();
    expect(june.find((r) => r.leader === 'JUN_L')).toBeTruthy();

    // An open-ended "since June 1" also excludes May.
    const since = await getLeaderStats({ scope, from: new Date('2026-06-01T00:00:00Z'), minGames: 1 });
    expect(since.find((r) => r.leader === 'MAY_L')).toBeUndefined();
    expect(since.find((r) => r.leader === 'JUN_L')).toBeTruthy();
  });

});

// B195 matchup drill-in: card-level stats + replays scoped to a specific matchup
// (leader A vs opponent leader B), powering the matrix-cell → matchup detail view.
describe('B195 matchup drill-in producers', () => {
  let u: string;
  beforeEach(async () => {
    u = await seedUser(false);
    await seedMatch({ gameId: 'm1', userId: u, p1: { leader: 'L1', won: true }, p2: { leader: 'L2', won: false }, events: [{ side: 'p1', cardId: 'CX', event: 'played' }] });
    await seedMatch({ gameId: 'm2', userId: u, p1: { leader: 'L1', won: false }, p2: { leader: 'L3', won: true }, events: [{ side: 'p1', cardId: 'CX', event: 'played' }] });
    await seedMatch({ gameId: 'm3', userId: u, p1: { leader: 'L1', won: true }, p2: { leader: 'L2', won: false }, events: [{ side: 'p1', cardId: 'CX', event: 'played' }] });
  });
  const scope = () => ({ kind: 'personal' as const, userId: u });

  it('getCardStats(leader, opponentLeader) scopes card stats to that matchup', async () => {
    const all = await getCardStats({ scope: scope(), event: 'played', leader: 'L1' });
    expect(all.find((r) => r.cardId === 'CX')!.observations).toBe(3); // all L1 games
    const vsL2 = await getCardStats({ scope: scope(), event: 'played', leader: 'L1', opponentLeader: 'L2' });
    expect(vsL2.find((r) => r.cardId === 'CX')!.observations).toBe(2); // m1 + m3 only
    expect(vsL2.find((r) => r.cardId === 'CX')!.wins).toBe(2);
  });

  it('getEntityReplays(leader, opponentLeader) lists only that matchup’s replays', async () => {
    const rows = await getEntityReplays({ scope: scope(), leader: 'L1', opponentLeader: 'L2' });
    expect(rows).toHaveLength(2); // m1, m3
    expect(rows.every((r) => r.won === true)).toBe(true);
  });
});
