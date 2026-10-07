import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { GET } from '@/app/api/stats/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, replays, matches, matchPlayers } from '@/lib/schema';

// B101/P1: the stats API's job is scope resolution + authorization (the
// aggregation itself is covered by stats-query.test). These pin the auth gates.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const as = (id: string | null) => vi.mocked(auth).mockResolvedValue(id ? ({ user: { id } } as any) : (null as any));

const req = (qs: string) => new Request(`http://t/api/stats?${qs}`);
beforeEach(() => vi.mocked(auth).mockReset());

async function seedUser() {
  const id = randomUUID();
  await getDb().insert(users).values({ id, email: `${id}@e.com` });
  return id;
}

describe('GET /api/stats — scope authorization', () => {
  it('global (whole-meta) scope is not exposed — rejected as a bad scope, for everyone', async () => {
    // The userbase-wide aggregate was removed for privacy (it shouldn't be reachable
    // by anyone, including admins). `scope=global` is now rejected like any unknown
    // scope — no admin gate, no data path.
    as(await seedUser());
    expect((await GET(req('type=leaders&scope=global'))).status).toBe(400);
    // No scope param defaults to personal, so it still needs a session.
    as(null);
    expect((await GET(req('type=leaders'))).status).toBe(401);
  });

  it('personal requires a session', async () => {
    as(null);
    expect((await GET(req('scope=personal'))).status).toBe(401);
    as(await seedUser());
    expect((await GET(req('scope=personal'))).status).toBe(200);
  });

  it('team requires membership (403 for a non-member, 200 for a member)', async () => {
    const owner = await seedUser();
    await getDb().insert(teams).values({ slug: 'tQ', name: 'Q', createdBy: owner });
    await getDb().insert(teamMembers).values({ teamSlug: 'tQ', userId: owner, role: 'owner' });

    as(await seedUser()); // a different, non-member user
    expect((await GET(req('scope=team&team=tQ'))).status).toBe(403);

    as(owner);
    const ok = await GET(req('scope=team&team=tQ'));
    expect(ok.status).toBe(200);
    expect((await ok.json()).scope).toBe('team');
  });

  it('validates type, event, and team-slug-required', async () => {
    as(await seedUser());
    expect((await GET(req('scope=team'))).status).toBe(400); // missing team
    expect((await GET(req('scope=personal&type=bogus'))).status).toBe(400);
    expect((await GET(req('scope=personal&type=cards&event=bogus'))).status).toBe(400);
    expect((await GET(req('scope=weird'))).status).toBe(400);
  });

  it('dispatches the deck-aware types (decks, matchups byBase)', async () => {
    as(await seedUser());
    const decks = await GET(req('scope=personal&type=decks&leader=L1'));
    expect(decks.status).toBe(200);
    expect((await decks.json())).toMatchObject({ ok: true, type: 'decks' });
    const byBase = await GET(req('scope=personal&type=matchups&byBase=1'));
    expect(byBase.status).toBe(200);
    expect(Array.isArray((await byBase.json()).data)).toBe(true);
  });

  it('B194: dispatches the drill-in types (matchups+leader, replays)', async () => {
    as(await seedUser());
    const m = await GET(req('scope=personal&type=matchups&leader=L1'));
    expect(m.status).toBe(200);
    expect((await m.json())).toMatchObject({ ok: true, type: 'matchups' });
    const r = await GET(req('scope=personal&type=replays&leader=L1'));
    expect(r.status).toBe(200);
    expect(Array.isArray((await r.json()).data)).toBe(true);
    as(null);
    expect((await GET(req('scope=personal&type=replays&leader=L1'))).status).toBe(401);
  });

  it('resourcing requires a session (personal/team only, like everything)', async () => {
    as(await seedUser());
    expect((await GET(req('scope=personal&type=resourcing'))).status).toBe(200);
    as(null);
    expect((await GET(req('scope=personal&type=resourcing'))).status).toBe(401);
  });
});

// A custom day range means the VIEWER's calendar days: the client sends its zone
// as `tz` and the server reads the days in it (it used to read them in its own
// zone, UTC on Vercel, so US-evening games vanished from "today").
describe('GET /api/stats — day ranges are the viewer\'s local days', () => {
  // One personal game played 2026-10-06 20:00 PDT = 2026-10-07 03:00 UTC.
  async function seedEveningGame(userId: string) {
    const gameId = 'tz-' + randomUUID().slice(0, 8);
    const slug = 'r_' + randomUUID().slice(0, 8);
    await getDb().insert(replays).values({ slug, gameId, userId, ownerToken: 'kbx_' + randomUUID(), ownerPlayerId: 'p1', players: [], payloadBlobUrl: 'memory://x', durationMs: 1 });
    await getDb().insert(matches).values({ gameId, replaySlug: slug, format: 'premier', result: 'decisive', createdAt: new Date('2026-10-07T03:00:00Z') });
    await getDb().insert(matchPlayers).values([
      { gameId, playerId: 'p1', leader: 'EVENING_L', opponentLeader: 'X', won: true, isRecorder: true, format: 'premier' },
      { gameId, playerId: 'p2', leader: 'X', opponentLeader: 'EVENING_L', won: false, isRecorder: false, format: 'premier' },
    ]);
  }
  const games = async (qs: string): Promise<number> => {
    const res = await GET(req(`scope=personal&type=leaders&${qs}`));
    expect(res.status).toBe(200);
    const rows = (await res.json()).data as Array<{ leader: string; games: number }>;
    return rows.find((r) => r.leader === 'EVENING_L')?.games ?? 0;
  };

  it('a game at 10-07 03:00Z counts for "Oct 6" in America/Los_Angeles, and not in UTC', async () => {
    const u = await seedUser();
    await seedEveningGame(u);
    as(u);
    const oct6 = 'range=2026-10-06..2026-10-06';
    const oct7 = 'range=2026-10-07..2026-10-07';
    expect(await games(`${oct6}&tz=America/Los_Angeles`)).toBe(1);
    expect(await games(`${oct7}&tz=America/Los_Angeles`)).toBe(0);
    expect(await games(`${oct6}&tz=UTC`)).toBe(0);
    expect(await games(`${oct7}&tz=UTC`)).toBe(1);
    // Clients from before `tz` existed, and bogus zones, get UTC days (what prod always did).
    expect(await games(oct6)).toBe(0);
    expect(await games(`${oct7}&tz=Mars%2FOlympus_Mons`)).toBe(1);
    // Open-ended ranges are read in the zone too.
    expect(await games('range=..2026-10-06&tz=America/Los_Angeles')).toBe(1);
    expect(await games('range=..2026-10-06&tz=UTC')).toBe(0);
    // Presets and "any time" ignore it.
    expect(await games('tz=Asia/Tokyo')).toBe(1);
    expect(await games('range=36500d&tz=Asia/Tokyo')).toBe(1);
  });
});
