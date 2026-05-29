import { describe, expect, it, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST as createTeam, GET as listTeams } from '@/app/api/teams/route';
import { getDb } from '@/lib/db';
import { users, teamMembers } from '@/lib/schema';
import { eq } from 'drizzle-orm';

// API integration test — exercises a real route handler against a real
// Postgres. Mocks just the auth() call so we don't need to spin up the
// full Auth.js cookie flow per test (covered by E2E).
//
// Setup pattern: each test creates a user fixture, mocks auth() to
// return that user, then invokes the route handler with a Request.

vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

const { auth } = await import('@/auth');
const mockedAuth = vi.mocked(auth);

async function seedUser(overrides: Partial<{ id: string; name: string; email: string }> = {}) {
  const id = overrides.id ?? randomUUID();
  const db = getDb();
  await db.insert(users).values({
    id,
    name: overrides.name ?? 'Test User',
    email: overrides.email ?? `${id}@example.com`,
  });
  return id;
}

function withSession(userId: string | null) {
  mockedAuth.mockResolvedValue(userId ? ({ user: { id: userId } } as any) : (null as any));
}

beforeEach(() => {
  mockedAuth.mockReset();
});

describe('POST /api/teams', () => {
  it('rejects anonymous callers', async () => {
    withSession(null);
    const req = new Request('http://test/api/teams', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test' }),
    });
    const res = await createTeam(req);
    expect(res.status).toBe(401);
  });

  it('creates a team and makes the caller an owner', async () => {
    const userId = await seedUser();
    withSession(userId);

    const req = new Request('http://test/api/teams', {
      method: 'POST',
      body: JSON.stringify({ name: 'Tournament Prep' }),
    });
    const res = await createTeam(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.slug).toMatch(/^[a-z0-9]+$/);

    // Caller becomes a member with role=owner.
    const db = getDb();
    const memberships = await db
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.teamSlug, body.slug));
    expect(memberships).toHaveLength(1);
    expect(memberships[0].userId).toBe(userId);
    expect(memberships[0].role).toBe('owner');
  });

  it('rejects empty + over-long names', async () => {
    const userId = await seedUser();
    withSession(userId);

    const empty = await createTeam(new Request('http://test/api/teams', {
      method: 'POST',
      body: JSON.stringify({ name: '   ' }),
    }));
    expect(empty.status).toBe(400);

    const long = await createTeam(new Request('http://test/api/teams', {
      method: 'POST',
      body: JSON.stringify({ name: 'a'.repeat(200) }),
    }));
    expect(long.status).toBe(400);
  });
});

describe('GET /api/teams', () => {
  it('returns only teams the caller belongs to', async () => {
    const userA = await seedUser({ name: 'A' });
    const userB = await seedUser({ name: 'B' });

    // A creates two teams; B creates one.
    withSession(userA);
    const teamA1 = await (await createTeam(new Request('http://test/api/teams', {
      method: 'POST', body: JSON.stringify({ name: 'A First' }),
    }))).json();
    const teamA2 = await (await createTeam(new Request('http://test/api/teams', {
      method: 'POST', body: JSON.stringify({ name: 'A Second' }),
    }))).json();

    withSession(userB);
    const teamB1 = await (await createTeam(new Request('http://test/api/teams', {
      method: 'POST', body: JSON.stringify({ name: 'B Only' }),
    }))).json();

    // A's list = 2 teams; B's list = 1 team.
    withSession(userA);
    const listA = await (await listTeams()).json();
    expect(listA.data.map((t: any) => t.slug).sort()).toEqual([teamA1.slug, teamA2.slug].sort());

    withSession(userB);
    const listB = await (await listTeams()).json();
    expect(listB.data.map((t: any) => t.slug)).toEqual([teamB1.slug]);
  });
});
