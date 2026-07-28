import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DELETE as removeMember } from '@/app/api/teams/[slug]/members/[userId]/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers } from '@/lib/schema';
import { and, eq } from 'drizzle-orm';

// A team owner can remove a member from the team. Owner-only; you can't remove
// yourself (so the team always keeps at least one owner). Only the membership row
// is dropped — the person's shared content stays.

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
const isMember = async (slug: string, userId: string) =>
  (await getDb().select().from(teamMembers).where(and(eq(teamMembers.teamSlug, slug), eq(teamMembers.userId, userId))).limit(1)).length > 0;
const roleOf = async (slug: string, userId: string) =>
  (await getDb().select().from(teamMembers).where(and(eq(teamMembers.teamSlug, slug), eq(teamMembers.userId, userId))).limit(1))[0]?.role;
const req = () => new Request('http://t', { method: 'DELETE' });
const p = (slug: string, userId: string) => ({ params: Promise.resolve({ slug, userId }) });

describe('DELETE /api/teams/[slug]/members/[userId] — remove a member', () => {
  it('owner removes a member', async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const slug = await seedTeam({ [owner]: 'owner', [member]: 'member' });

    as(owner);
    const res = await removeMember(req(), p(slug, member));
    expect(res.status).toBe(200);
    expect(await isMember(slug, member)).toBe(false);
    expect(await isMember(slug, owner)).toBe(true); // acting owner unaffected
  });

  it('owner can remove a co-owner and stays an owner (team keeps an owner)', async () => {
    const owner = await seedUser();
    const coOwner = await seedUser();
    const slug = await seedTeam({ [owner]: 'owner', [coOwner]: 'owner' });

    as(owner);
    expect((await removeMember(req(), p(slug, coOwner))).status).toBe(200);
    expect(await isMember(slug, coOwner)).toBe(false);
    expect(await roleOf(slug, owner)).toBe('owner');
  });

  it('rejects a non-owner caller (403) and leaves the target in place', async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const other = await seedUser();
    const slug = await seedTeam({ [owner]: 'owner', [member]: 'member', [other]: 'member' });

    as(member);
    expect((await removeMember(req(), p(slug, other))).status).toBe(403);
    expect(await isMember(slug, other)).toBe(true);
  });

  it('400s removing yourself, and you stay a member', async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const slug = await seedTeam({ [owner]: 'owner', [member]: 'member' });

    as(owner);
    expect((await removeMember(req(), p(slug, owner))).status).toBe(400);
    expect(await isMember(slug, owner)).toBe(true);
  });

  it('404s when the target is not a team member', async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const slug = await seedTeam({ [owner]: 'owner' });

    as(owner);
    expect((await removeMember(req(), p(slug, stranger))).status).toBe(404);
  });

  it('401s an anonymous caller', async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const slug = await seedTeam({ [owner]: 'owner', [member]: 'member' });

    as(null);
    expect((await removeMember(req(), p(slug, member))).status).toBe(401);
    expect(await isMember(slug, member)).toBe(true);
  });
});
