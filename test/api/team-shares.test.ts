import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { GET as getShares, POST as addShare, DELETE as removeShare } from '@/app/api/replays/[slug]/team-shares/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, replays, replayTeamShares } from '@/lib/schema';
import { eq } from 'drizzle-orm';

// B79: who can share a replay with a team — owner-only AND must be a member of
// the target team (so a slug alone can't pollute a team's grid).

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const as = (userId: string | null) => vi.mocked(auth).mockResolvedValue(userId ? ({ user: { id: userId } } as any) : (null as any));

async function seedUser() {
  const id = randomUUID();
  await getDb().insert(users).values({ id, name: 'U', email: `${id}@e.com` });
  return id;
}
async function seedTeam(owner: string, members: string[] = [owner]) {
  const slug = randomUUID().slice(0, 6);
  await getDb().insert(teams).values({ slug, name: slug, createdBy: owner });
  await getDb().insert(teamMembers).values(members.map((userId) => ({ teamSlug: slug, userId, role: userId === owner ? 'owner' : 'member' })));
  return slug;
}
async function seedReplay(ownerUserId: string) {
  const slug = randomUUID().slice(0, 8);
  await getDb().insert(replays).values({
    slug, gameId: randomUUID(), userId: ownerUserId, ownerToken: `kbx_${randomUUID()}`,
    players: [{ username: 'A' }], payloadBlobUrl: `https://blob.test/${slug}.json`,
  });
  return slug;
}
const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
const post = (slug: string, teamSlug: unknown) => addShare(new Request('http://t', { method: 'POST', body: JSON.stringify({ teamSlug }) }), params(slug));

beforeEach(() => vi.mocked(auth).mockReset());

describe('POST /replays/:slug/team-shares', () => {
  it('owner who is a member can share (idempotently)', async () => {
    const owner = await seedUser();
    const team = await seedTeam(owner);
    const slug = await seedReplay(owner);
    as(owner);

    expect((await post(slug, team)).status).toBe(200);
    expect((await post(slug, team)).status).toBe(200); // idempotent
    const shares = await getDb().select().from(replayTeamShares).where(eq(replayTeamShares.replaySlug, slug));
    expect(shares).toHaveLength(1);
  });

  it('401 when signed out', async () => {
    const owner = await seedUser();
    const slug = await seedReplay(owner);
    as(null);
    expect((await post(slug, 'whatever')).status).toBe(401);
  });

  it('403 when the caller does not own the replay', async () => {
    const owner = await seedUser();
    const team = await seedTeam(owner);
    const slug = await seedReplay(owner);
    const stranger = await seedUser();
    as(stranger);
    expect((await post(slug, team)).status).toBe(403);
  });

  it('403 when the owner is not a member of the target team', async () => {
    const owner = await seedUser();
    const otherOwner = await seedUser();
    const foreignTeam = await seedTeam(otherOwner); // owner is NOT in this team
    const slug = await seedReplay(owner);
    as(owner);
    expect((await post(slug, foreignTeam)).status).toBe(403);
  });

  it('400 without a teamSlug', async () => {
    const owner = await seedUser();
    const slug = await seedReplay(owner);
    as(owner);
    expect((await post(slug, '')).status).toBe(400);
  });
});

describe('GET + DELETE /replays/:slug/team-shares', () => {
  it('GET lists shares + the owner’s teams; non-owner is 403', async () => {
    const owner = await seedUser();
    const team = await seedTeam(owner);
    const slug = await seedReplay(owner);
    as(owner);
    await post(slug, team);

    const body = await (await getShares(new Request('http://t'), params(slug))).json();
    expect(body.ok).toBe(true);
    expect(body.shares.map((s: any) => s.teamSlug)).toEqual([team]);
    expect(body.ownerTeams.map((t: any) => t.slug)).toContain(team);

    as(await seedUser());
    expect((await getShares(new Request('http://t'), params(slug))).status).toBe(403);
  });

  it('DELETE removes a share (owner only)', async () => {
    const owner = await seedUser();
    const team = await seedTeam(owner);
    const slug = await seedReplay(owner);
    as(owner);
    await post(slug, team);

    const res = await removeShare(new Request('http://t', { method: 'DELETE', body: JSON.stringify({ teamSlug: team }) }), params(slug));
    expect(res.status).toBe(200);
    expect(await getDb().select().from(replayTeamShares).where(eq(replayTeamShares.replaySlug, slug))).toHaveLength(0);
  });
});
