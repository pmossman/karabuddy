import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST } from '@/app/api/me/active-team/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers } from '@/lib/schema';

// Phase A — POST /api/me/active-team sets the kb_team cookie after a membership
// check. Cookie write must happen in a route handler (illegal during RSC
// render); the resolver only reads it.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const as = (userId: string | null) =>
  vi.mocked(auth).mockResolvedValue(userId ? ({ user: { id: userId } } as any) : (null as any));

async function seedUser() {
  const id = randomUUID();
  await getDb().insert(users).values({ id, name: 'U', email: `${id}@e.com` });
  return id;
}
async function seedTeam(owner: string, members: string[] = [owner]) {
  const slug = randomUUID().slice(0, 6);
  await getDb().insert(teams).values({ slug, name: slug, createdBy: owner });
  await getDb()
    .insert(teamMembers)
    .values(members.map((userId) => ({ teamSlug: slug, userId, role: userId === owner ? 'owner' : 'member' })));
  return slug;
}
const post = (slug: unknown) =>
  POST(new Request('http://t/api/me/active-team', { method: 'POST', body: JSON.stringify({ slug }) }));

beforeEach(() => vi.mocked(auth).mockReset());

describe('POST /api/me/active-team', () => {
  it('member slug → 200 and Set-Cookie kb_team', async () => {
    const user = await seedUser();
    const team = await seedTeam(user);
    as(user);

    const res = await post(team);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toContain(`kb_team=${team}`);
    expect(setCookie.toLowerCase()).toContain('httponly');
    expect(setCookie.toLowerCase()).toContain('samesite=lax');
    expect(setCookie).toContain('Path=/');
  });

  it('non-member slug → 403, no cookie set', async () => {
    const user = await seedUser();
    const otherOwner = await seedUser();
    const foreignTeam = await seedTeam(otherOwner); // user is NOT a member
    as(user);

    const res = await post(foreignTeam);
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('signed out → 401', async () => {
    as(null);
    const res = await post('whatever');
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
