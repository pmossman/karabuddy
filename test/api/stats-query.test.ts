import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db';
import { users, teams, replays, matches, matchPlayers, replayTeamShares } from '@/lib/schema';
import { getLeaderStats, getLeaderMatchups } from '@/lib/statsQuery';

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
  p1: { leader: string; won: boolean };
  p2: { leader: string; won: boolean };
  shareTeam?: string;
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
    { gameId: opts.gameId, playerId: 'p1', leader: opts.p1.leader, opponentLeader: opts.p2.leader, won: opts.p1.won, isRecorder: true, format },
    { gameId: opts.gameId, playerId: 'p2', leader: opts.p2.leader, opponentLeader: opts.p1.leader, won: opts.p2.won, isRecorder: false, format },
  ]);
  if (opts.shareTeam) await db.insert(replayTeamShares).values({ replaySlug: slug, teamSlug: opts.shareTeam, sharedBy: opts.userId ?? null });
  return slug;
}

beforeEach(async () => {
  const db = getDb();
  userA = await seedUser(false);
  userB = await seedUser(true); // opted OUT of global
  await db.insert(teams).values({ slug: 'tT', name: 'Team T', createdBy: userA });

  // userA: two games, L1 vs L2, 1 win each side. game1 shared with team T.
  const g1 = 'q-' + id().slice(0, 6);
  await seedMatch({ gameId: g1, userId: userA, p1: { leader: 'L1', won: true }, p2: { leader: 'L2', won: false }, shareTeam: 'tT' });
  await seedMatch({ gameId: 'q-' + id().slice(0, 6), userId: userA, p1: { leader: 'L1', won: false }, p2: { leader: 'L2', won: true } });
  // userB (opted out): L1 wins vs L3 — must NOT appear in global.
  await seedMatch({ gameId: 'q-' + id().slice(0, 6), userId: userB, p1: { leader: 'L1', won: true }, p2: { leader: 'L3', won: false } });
  // anonymous upload: L1 wins vs L3 — included in global (no user to opt out).
  await seedMatch({ gameId: 'q-' + id().slice(0, 6), userId: null, p1: { leader: 'L1', won: true }, p2: { leader: 'L3', won: false } });
});

const byLeader = (rows: { leader: string }[]) => Object.fromEntries(rows.map((r) => [r.leader, r])) as Record<string, any>;

describe('getLeaderStats — scope isolation', () => {
  it('personal = only my replays', async () => {
    const m = byLeader(await getLeaderStats({ scope: { kind: 'personal', userId: userA } }));
    expect(m.L1.games).toBe(2);
    expect(m.L1.wins).toBe(1);
    expect(m.L1.winRate).toBeCloseTo(0.5);
    expect(m.L2.games).toBe(2);
    expect(m.L3).toBeUndefined(); // L3 only appears in userB/anon games
  });

  it('global excludes an opted-out uploader but keeps anonymous uploads', async () => {
    const m = byLeader(await getLeaderStats({ scope: { kind: 'global' } }));
    // L1: userA ×2 + anon ×1 = 3 (userB's game excluded). Wins: g1 win, g2 loss, anon win = 2.
    expect(m.L1.games).toBe(3);
    expect(m.L1.wins).toBe(2);
    // L3 appears only via the anon game (userB's L3 game excluded) → 1, not 2.
    expect(m.L3.games).toBe(1);
  });

  it('min-N gates low-sample rows out of global', async () => {
    const m = byLeader(await getLeaderStats({ scope: { kind: 'global' }, minGames: 3 }));
    expect(m.L1).toBeDefined(); // 3 games
    expect(m.L2).toBeUndefined(); // 2 games — below the floor
    expect(m.L3).toBeUndefined(); // 1 game
  });

  it('team = only replays shared with that team', async () => {
    const m = byLeader(await getLeaderStats({ scope: { kind: 'team', teamSlug: 'tT' } }));
    expect(m.L1.games).toBe(1); // only game1 was shared
    expect(m.L2.games).toBe(1);
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
