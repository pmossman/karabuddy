import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { GET } from '@/app/api/stats/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers } from '@/lib/schema';

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
  it('global/community stats are disabled — scope=global is rejected', async () => {
    as(await seedUser());
    expect((await GET(req('type=leaders&scope=global'))).status).toBe(400);
    // No scope param defaults to personal (not global), so it needs a session.
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
