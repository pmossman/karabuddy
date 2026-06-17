import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PATCH as transfer } from '@/app/api/teams/[slug]/members/[userId]/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers } from '@/lib/schema';
import { and, eq } from 'drizzle-orm';

// B160: a team owner can hand ownership to another member (the acting owner
// steps down to a regular member; any other owners are unaffected).

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const as = (id: string | null) => vi.mocked(auth).mockResolvedValue(id ? ({ user: { id } } as any) : (null as any));
beforeEach(() => vi.mocked(auth).mockReset());

async function seedUser() {
  const id = randomUUID();
  await getDb().insert(users).values({ id, name: id.slice(0, 5), email: `${id}@e.com` });
  return id;
}
async function seedTeam(roles: Record<string, 'owner' | 'member'>) {
  const slug = randomUUID().slice(0, 6);
  const ids = Object.keys(roles);
  await getDb().insert(teams).values({ slug, name: slug, createdBy: ids[0] });
  await getDb().insert(teamMembers).values(ids.map((u) => ({ teamSlug: slug, userId: u, role: roles[u] })));
  return slug;
}
const roleOf = async (slug: string, userId: string) =>
  (await getDb().select().from(teamMembers).where(and(eq(teamMembers.teamSlug, slug), eq(teamMembers.userId, userId))).limit(1))[0]?.role;
const req = (body: unknown) => new Request('http://t', { method: 'PATCH', body: JSON.stringify(body) });
const p = (slug: string, userId: string) => ({ params: Promise.resolve({ slug, userId }) });

describe('PATCH /api/teams/[slug]/members/[userId] — transfer ownership', () => {
  it('owner promotes a member and steps down to member', async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const slug = await seedTeam({ [owner]: 'owner', [member]: 'member' });

    as(owner);
    const res = await transfer(req({ role: 'owner' }), p(slug, member));
    expect(res.status).toBe(200);
    expect(await roleOf(slug, member)).toBe('owner');
    expect(await roleOf(slug, owner)).toBe('member');
  });

  it('leaves other owners untouched (team keeps an owner)', async () => {
    const owner = await seedUser();
    const coOwner = await seedUser();
    const member = await seedUser();
    const slug = await seedTeam({ [owner]: 'owner', [coOwner]: 'owner', [member]: 'member' });

    as(owner);
    await transfer(req({ role: 'owner' }), p(slug, member));
    expect(await roleOf(slug, member)).toBe('owner');
    expect(await roleOf(slug, owner)).toBe('member');
    expect(await roleOf(slug, coOwner)).toBe('owner'); // untouched
  });

  it('rejects a non-owner caller (403)', async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const other = await seedUser();
    const slug = await seedTeam({ [owner]: 'owner', [member]: 'member', [other]: 'member' });
    as(member);
    expect((await transfer(req({ role: 'owner' }), p(slug, other))).status).toBe(403);
  });

  it('404s when the target is not a team member', async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const slug = await seedTeam({ [owner]: 'owner' });
    as(owner);
    expect((await transfer(req({ role: 'owner' }), p(slug, stranger))).status).toBe(404);
  });

  it('400s transferring to yourself, and on an unsupported body', async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const slug = await seedTeam({ [owner]: 'owner', [member]: 'member' });
    as(owner);
    expect((await transfer(req({ role: 'owner' }), p(slug, owner))).status).toBe(400);
    expect((await transfer(req({ role: 'member' }), p(slug, member))).status).toBe(400);
  });

  it('401s an anonymous caller', async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const slug = await seedTeam({ [owner]: 'owner', [member]: 'member' });
    as(null);
    expect((await transfer(req({ role: 'owner' }), p(slug, member))).status).toBe(401);
  });
});
