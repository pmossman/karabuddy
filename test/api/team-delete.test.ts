import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST as deleteTeam } from '@/app/api/teams/[slug]/delete/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, replays, replayTeamShares } from '@/lib/schema';
import { eq } from 'drizzle-orm';

// A team OWNER can permanently delete a team (POST .../delete — DELETE is "leave").
// Owner-only, requires typing the exact team name, and every team-child cascades
// while members' replays survive (un-shared, not deleted).

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const as = (id: string | null) => vi.mocked(auth).mockResolvedValue(id ? ({ user: { id } } as any) : (null as any));
beforeEach(() => vi.mocked(auth).mockReset());

async function seedUser() {
  const id = randomUUID();
  await getDb().insert(users).values({ id, name: id.slice(0, 5), email: `${id}@e.com` });
  return id;
}
async function seedTeam(name: string, roles: Record<string, 'owner' | 'member'>) {
  const slug = randomUUID().slice(0, 6);
  const ids = Object.keys(roles);
  await getDb().insert(teams).values({ slug, name, createdBy: ids[0] });
  await getDb().insert(teamMembers).values(ids.map((u) => ({ teamSlug: slug, userId: u, role: roles[u] })));
  return slug;
}
const req = (body: unknown) => new Request('http://t', { method: 'POST', body: JSON.stringify(body) });
const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const teamExists = async (slug: string) => (await getDb().select().from(teams).where(eq(teams.slug, slug))).length > 0;

describe('POST /api/teams/[slug]/delete', () => {
  it('owner with the exact team name deletes it; children cascade, replays survive', async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const slug = await seedTeam('Cool Team', { [owner]: 'owner', [member]: 'member' });
    // a replay owned by `owner`, shared with the team
    const rslug = 'r_' + randomUUID().slice(0, 8);
    await getDb().insert(replays).values({ slug: rslug, gameId: 'g_' + randomUUID().slice(0, 8), userId: owner, ownerToken: 'kbx_' + randomUUID(), players: [], payloadBlobUrl: 'memory://x', durationMs: 1 });
    await getDb().insert(replayTeamShares).values({ replaySlug: rslug, teamSlug: slug, sharedBy: owner });

    as(owner);
    const res = await deleteTeam(req({ confirm: 'Cool Team' }), ctx(slug));
    expect(res.status).toBe(200);
    expect(await teamExists(slug)).toBe(false);
    // cascaded children gone:
    expect(await getDb().select().from(teamMembers).where(eq(teamMembers.teamSlug, slug))).toHaveLength(0);
    expect(await getDb().select().from(replayTeamShares).where(eq(replayTeamShares.teamSlug, slug))).toHaveLength(0);
    // the replay itself SURVIVES (no team FK — just un-shared):
    expect(await getDb().select().from(replays).where(eq(replays.slug, rslug))).toHaveLength(1);
  });

  it('rejects a non-owner member (403); team survives', async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const slug = await seedTeam('Cool Team', { [owner]: 'owner', [member]: 'member' });
    as(member);
    expect((await deleteTeam(req({ confirm: 'Cool Team' }), ctx(slug))).status).toBe(403);
    expect(await teamExists(slug)).toBe(true);
  });

  it('401s an anonymous caller; team survives', async () => {
    const owner = await seedUser();
    const slug = await seedTeam('Cool Team', { [owner]: 'owner' });
    as(null);
    expect((await deleteTeam(req({ confirm: 'Cool Team' }), ctx(slug))).status).toBe(401);
    expect(await teamExists(slug)).toBe(true);
  });

  it('400s when the typed name does not match exactly; team survives', async () => {
    const owner = await seedUser();
    const slug = await seedTeam('Cool Team', { [owner]: 'owner' });
    as(owner);
    expect((await deleteTeam(req({ confirm: 'cool team' }), ctx(slug))).status).toBe(400); // case-sensitive
    expect((await deleteTeam(req({ confirm: '' }), ctx(slug))).status).toBe(400);
    expect((await deleteTeam(req({}), ctx(slug))).status).toBe(400);
    expect(await teamExists(slug)).toBe(true);
  });
});
