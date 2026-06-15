import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST as review } from '@/app/api/replays/[slug]/review/route';
import { POST as reviewed } from '@/app/api/replays/[slug]/reviewed/route';
import { GET as queue } from '@/app/api/teams/[slug]/review-queue/route';
import { GET as myRequests } from '@/app/api/me/review-requests/route';
import { GET as reviewStatus } from '@/app/api/replays/[slug]/review-status/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, replays, replayTeamShares, tags, tagTeamScope } from '@/lib/schema';

// B149 / ADR 0009: durable, multi-reviewer team reviews. The owner REQUESTS
// (and cancels); each member leaves a per-user mark (/reviewed) that accrues and
// never wipes the request — so multiple eyes accumulate and nothing vanishes.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/reviewNotify', () => ({ notifyTeamReview: vi.fn(), notifyReviewMark: vi.fn() }));
const { auth } = await import('@/auth');
const as = (userId: string | null) => vi.mocked(auth).mockResolvedValue(userId ? ({ user: { id: userId } } as any) : (null as any));

async function seedUser(name = 'U') {
  const id = randomUUID();
  await getDb().insert(users).values({ id, name, email: `${id}@e.com` });
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
async function seedTag(slug: string, teamSlug: string, authorName: string, userId?: string) {
  const id = randomUUID();
  await getDb().insert(tags).values({ id, replaySlug: slug, frameIndex: 0, authorToken: `kbx_${randomUUID()}`, authorName, userId: userId ?? null, comment: 'gg' });
  await getDb().insert(tagTeamScope).values({ tagId: id, teamSlug });
}
const reviewReq = (slug: string, body: unknown) =>
  review(new Request('http://t', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ slug }) });
const markReq = (slug: string, body: unknown) =>
  reviewed(new Request('http://t', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ slug }) });
const getQueue = (teamSlug: string) => queue(new Request('http://t'), { params: Promise.resolve({ slug: teamSlug }) });
const getStatus = (slug: string) => reviewStatus(new Request('http://t'), { params: Promise.resolve({ slug }) });

beforeEach(() => vi.mocked(auth).mockReset());

describe('review request (owner)', () => {
  it('owner requests review; it lands in the team queue with the requester recorded', async () => {
    const owner = await seedUser();
    const team = await seedTeam(owner);
    const slug = await seedReplay(owner);
    await share(slug, team, owner);

    as(owner);
    expect((await reviewReq(slug, { teamSlug: team, requested: true })).status).toBe(200);

    const q = await (await getQueue(team)).json();
    expect(q.data.map((r: any) => r.slug)).toEqual([slug]);
    expect(q.data[0].reviewRequestedAt).toBeTruthy();
    expect(q.data[0].reviewRequestedBy).toBe(owner);
    expect(q.data[0].reviewerCount).toBe(0);
  });

  it('rejects a request for a team the replay is NOT shared with', async () => {
    const owner = await seedUser();
    const team = await seedTeam(owner);
    const slug = await seedReplay(owner);
    as(owner);
    expect((await reviewReq(slug, { teamSlug: team, requested: true })).status).toBe(400);
  });

  it('a non-owner cannot request OR cancel', async () => {
    const owner = await seedUser();
    const other = await seedUser();
    const team = await seedTeam(owner, [owner, other]);
    const slug = await seedReplay(owner);
    await share(slug, team, owner);
    as(other);
    expect((await reviewReq(slug, { teamSlug: team, requested: true })).status).toBe(403);
    as(owner);
    await reviewReq(slug, { teamSlug: team, requested: true });
    as(other);
    expect((await reviewReq(slug, { teamSlug: team, requested: false })).status).toBe(403); // member can't cancel
  });

  it('owner can CANCEL the request (it leaves the queue)', async () => {
    const owner = await seedUser();
    const team = await seedTeam(owner);
    const slug = await seedReplay(owner);
    await share(slug, team, owner);
    as(owner);
    await reviewReq(slug, { teamSlug: team, requested: true });
    expect((await reviewReq(slug, { teamSlug: team, requested: false })).status).toBe(200);
    expect((await (await getQueue(team)).json()).data).toHaveLength(0);
  });
});

describe('per-user review marks (members)', () => {
  it('a member marks reviewed; the replay STAYS in the queue (reviewed by N, never vanishes)', async () => {
    const owner = await seedUser('Owner');
    const a = await seedUser('Ann');
    const b = await seedUser('Bo');
    const team = await seedTeam(owner, [owner, a, b]);
    const slug = await seedReplay(owner);
    await share(slug, team, owner);
    await seedTag(slug, team, 'Ann', a);   // a review requires a comment
    await seedTag(slug, team, 'Bo', b);
    as(owner);
    await reviewReq(slug, { teamSlug: team, requested: true });

    as(a);
    expect((await markReq(slug, { teamSlug: team, reviewed: true })).status).toBe(200);
    let q = await (await getQueue(team)).json();
    expect(q.data).toHaveLength(1);                  // did NOT vanish
    expect(q.data[0].reviewerCount).toBe(1);
    expect(q.data[0].viewerReviewed).toBe(true);     // viewer = Ann
    expect(q.data[0].reviewers.map((r: any) => r.name)).toEqual(['Ann']);

    // Second reviewer — multiple eyes accumulate.
    as(b);
    await markReq(slug, { teamSlug: team, reviewed: true });
    q = await (await getQueue(team)).json();
    expect(q.data[0].reviewerCount).toBe(2);
    expect(q.data[0].viewerReviewed).toBe(true);     // viewer = Bo

    // From a member who hasn't reviewed, viewerReviewed is false.
    as(owner);
    q = await (await getQueue(team)).json();
    expect(q.data[0].reviewerCount).toBe(2);
    expect(q.data[0].viewerReviewed).toBe(false);
  });

  it('marking is idempotent and reversible (un-review)', async () => {
    const owner = await seedUser();
    const a = await seedUser();
    const team = await seedTeam(owner, [owner, a]);
    const slug = await seedReplay(owner);
    await share(slug, team, owner);
    await seedTag(slug, team, 'A', a);
    as(owner);
    await reviewReq(slug, { teamSlug: team, requested: true });

    as(a);
    await markReq(slug, { teamSlug: team, reviewed: true });
    await markReq(slug, { teamSlug: team, reviewed: true }); // repeat → still 1
    expect((await (await getQueue(team)).json()).data[0].reviewerCount).toBe(1);
    await markReq(slug, { teamSlug: team, reviewed: false }); // un-review
    expect((await (await getQueue(team)).json()).data[0].reviewerCount).toBe(0);
  });

  it('cannot mark reviewed without leaving a comment (gated on team-scoped feedback)', async () => {
    const owner = await seedUser();
    const a = await seedUser('Ann');
    const team = await seedTeam(owner, [owner, a]);
    const slug = await seedReplay(owner);
    await share(slug, team, owner);
    as(owner);
    await reviewReq(slug, { teamSlug: team, requested: true });

    // No comment yet → blocked, and the queue flags it for the UI.
    as(a);
    expect((await markReq(slug, { teamSlug: team, reviewed: true })).status).toBe(400);
    let q = await (await getQueue(team)).json();
    expect(q.data[0].viewerCommented).toBe(false);
    expect(q.data[0].reviewerCount).toBe(0);

    // Comment, then the mark goes through.
    await seedTag(slug, team, 'Ann', a);
    q = await (await getQueue(team)).json();
    expect(q.data[0].viewerCommented).toBe(true);
    expect((await markReq(slug, { teamSlug: team, reviewed: true })).status).toBe(200);
    expect((await (await getQueue(team)).json()).data[0].reviewerCount).toBe(1);
  });

  it('requires an OPEN request (requested-only) and team membership', async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const stranger = await seedUser();
    const team = await seedTeam(owner, [owner, member]);
    const slug = await seedReplay(owner);
    await share(slug, team, owner);

    // shared but NOT requested → 400
    as(member);
    expect((await markReq(slug, { teamSlug: team, reviewed: true })).status).toBe(400);

    as(owner);
    await reviewReq(slug, { teamSlug: team, requested: true });
    // non-member → 403
    as(stranger);
    expect((await markReq(slug, { teamSlug: team, reviewed: true })).status).toBe(403);
  });
});

describe('queue enrichment — commenters', () => {
  it('surfaces team-scoped commenters + count alongside the review marks', async () => {
    const owner = await seedUser();
    const team = await seedTeam(owner);
    const slug = await seedReplay(owner);
    await share(slug, team, owner);
    await seedTag(slug, team, 'Reviewer Rhea');
    await seedTag(slug, team, 'Reviewer Rhea'); // same author twice → one name, count 2
    as(owner);
    await reviewReq(slug, { teamSlug: team, requested: true });

    const q = await (await getQueue(team)).json();
    expect(q.data[0].commentCount).toBe(2);
    expect(q.data[0].commenters).toEqual(['Reviewer Rhea']);
  });
});

describe('requester surface — /me/review-requests', () => {
  it('returns the requester’s open requests with reviewer counts', async () => {
    const owner = await seedUser();
    const a = await seedUser('Ann');
    const team = await seedTeam(owner, [owner, a]);
    const slug = await seedReplay(owner);
    await share(slug, team, owner);
    await seedTag(slug, team, 'Ann', a);
    as(owner);
    await reviewReq(slug, { teamSlug: team, requested: true });
    as(a);
    await markReq(slug, { teamSlug: team, reviewed: true });

    as(owner);
    const r = await (await myRequests()).json();
    expect(r.data).toHaveLength(1);
    expect(r.data[0].slug).toBe(slug);
    expect(r.data[0].teamSlug).toBe(team);
    expect(r.data[0].reviewerCount).toBe(1);
    expect(r.data[0].reviewers[0].name).toBe('Ann');
  });

  it('does not show requests another user opened', async () => {
    const owner = await seedUser();
    const other = await seedUser();
    const team = await seedTeam(owner, [owner, other]);
    const slug = await seedReplay(owner);
    await share(slug, team, owner);
    as(owner);
    await reviewReq(slug, { teamSlug: team, requested: true });

    as(other);
    expect((await (await myRequests()).json()).data).toHaveLength(0);
    as(null);
    expect((await myRequests()).status).toBe(401);
  });
});

describe('viewer review-status — /review-status', () => {
  it('returns per-team status for a member with an open request, gated on commenting', async () => {
    const owner = await seedUser();
    const a = await seedUser('Ann');
    const team = await seedTeam(owner, [owner, a]);
    const slug = await seedReplay(owner);
    await share(slug, team, owner);
    as(owner);
    await reviewReq(slug, { teamSlug: team, requested: true });

    // Member, no comment yet → status present, not yet reviewable.
    as(a);
    let s = await (await getStatus(slug)).json();
    expect(s.data).toHaveLength(1);
    expect(s.data[0]).toMatchObject({ teamSlug: team, reviewerCount: 0, viewerReviewed: false, viewerCommented: false });

    // Comment + mark → reflected in status.
    await seedTag(slug, team, 'Ann', a);
    await markReq(slug, { teamSlug: team, reviewed: true });
    s = await (await getStatus(slug)).json();
    expect(s.data[0]).toMatchObject({ reviewerCount: 1, viewerReviewed: true, viewerCommented: true });
    expect(s.data[0].reviewers[0].name).toBe('Ann');
  });

  it('omits teams with no open request, and is empty for non-members / signed-out', async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const team = await seedTeam(owner);
    const slug = await seedReplay(owner);
    await share(slug, team, owner); // shared but NOT requested
    as(owner);
    expect((await (await getStatus(slug)).json()).data).toHaveLength(0); // no open request

    await reviewReq(slug, { teamSlug: team, requested: true });
    as(stranger);
    expect((await (await getStatus(slug)).json()).data).toHaveLength(0); // not a member
    as(null);
    expect((await (await getStatus(slug)).json()).data).toHaveLength(0); // signed out
  });
});

describe('queue access', () => {
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
