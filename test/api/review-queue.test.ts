import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST as review } from '@/app/api/replays/[slug]/review/route';
import { GET as queue } from '@/app/api/teams/[slug]/review-queue/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, replays, replayTeamShares } from '@/lib/schema';

// B135: team review queue — the uploader flags a shared replay for review;
// any team member can mark it reviewed (clear it).

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
async function share(slug: string, teamSlug: string, by: string) {
  await getDb().insert(replayTeamShares).values({ replaySlug: slug, teamSlug, sharedBy: by });
}
const reviewReq = (slug: string, body: unknown) =>
  review(new Request('http://t', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ slug }) });
const getQueue = (teamSlug: string) => queue(new Request('http://t'), { params: Promise.resolve({ slug: teamSlug }) });

beforeEach(() => vi.mocked(auth).mockReset());

describe('B135: review request', () => {
  it('owner requests review on a shared team; it lands in that team’s queue', async () => {
    const owner = await seedUser();
    const team = await seedTeam(owner);
    const slug = await seedReplay(owner);
    await share(slug, team, owner);

    as(owner);
    const res = await reviewReq(slug, { teamSlug: team, requested: true });
    expect(res.status).toBe(200);

    const q = await (await getQueue(team)).json();
    expect(q.data.map((r: any) => r.slug)).toEqual([slug]);
    expect(q.data[0].reviewRequestedAt).toBeTruthy();
  });

  it('rejects a request for a team the replay is NOT shared with', async () => {
    const owner = await seedUser();
    const team = await seedTeam(owner);
    const slug = await seedReplay(owner);
    // not shared
    as(owner);
    const res = await reviewReq(slug, { teamSlug: team, requested: true });
    expect(res.status).toBe(400);
  });

  it('a non-owner cannot REQUEST review', async () => {
    const owner = await seedUser();
    const other = await seedUser();
    const team = await seedTeam(owner, [owner, other]);
    const slug = await seedReplay(owner);
    await share(slug, team, owner);
    as(other);
    const res = await reviewReq(slug, { teamSlug: team, requested: true });
    expect(res.status).toBe(403);
  });
});

describe('B135: mark reviewed', () => {
  it('ANY team member can clear it; it leaves the queue', async () => {
    const owner = await seedUser();
    const mate = await seedUser();
    const team = await seedTeam(owner, [owner, mate]);
    const slug = await seedReplay(owner);
    await share(slug, team, owner);
    as(owner);
    await reviewReq(slug, { teamSlug: team, requested: true });

    // The teammate (not the owner) marks it reviewed.
    as(mate);
    const res = await reviewReq(slug, { teamSlug: team, requested: false });
    expect(res.status).toBe(200);

    const q = await (await getQueue(team)).json();
    expect(q.data).toHaveLength(0);
  });

  it('a non-member cannot clear it', async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const team = await seedTeam(owner);
    const slug = await seedReplay(owner);
    await share(slug, team, owner);
    as(owner);
    await reviewReq(slug, { teamSlug: team, requested: true });

    as(stranger);
    expect((await reviewReq(slug, { teamSlug: team, requested: false })).status).toBe(403);
  });
});

describe('B135: queue access', () => {
  it('is member-gated', async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const team = await seedTeam(owner);
    as(stranger);
    expect((await getQueue(team)).status).toBe(403);
    as(null);
    expect((await getQueue(team)).status).toBe(401);
  });
});
