import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST as shareToken } from '@/app/api/replays/[slug]/share-token/route';
import { verifyMoment } from '@/lib/shareToken';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, replays, replayTeamShares, tags, tagTeamScope } from '@/lib/schema';

// B113: a share token may only be minted for a tag the caller can actually see
// (the same predicate the tags GET uses) — so a shared link can never expose a
// teammate's private tag.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const as = (id: string | null) => vi.mocked(auth).mockResolvedValue(id ? ({ user: { id } } as any) : (null as any));

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
const call = (slug: string, body: any, viewerId: string | null) => {
  as(viewerId);
  return shareToken(new Request(`http://t/api/replays/${slug}/share-token`, { method: 'POST', body: JSON.stringify(body) }), params(slug));
};

async function seedUser() { const id = randomUUID(); await getDb().insert(users).values({ id, name: id.slice(0, 4), email: `${id}@e.com` }); return id; }
async function seedTeam(owner: string, members: string[]) {
  const slug = randomUUID().slice(0, 6);
  await getDb().insert(teams).values({ slug, name: slug, createdBy: owner });
  await getDb().insert(teamMembers).values(members.map((u) => ({ teamSlug: slug, userId: u, role: u === owner ? 'owner' : 'member' })));
  return slug;
}
async function seedReplay(userId: string) {
  const slug = 'r_' + randomUUID().slice(0, 6);
  await getDb().insert(replays).values({ slug, gameId: randomUUID(), userId, ownerToken: `kbx_${randomUUID()}`, players: [{ username: 'A' }, { username: 'B' }], payloadBlobUrl: `https://blob.test/${slug}.json` });
  return slug;
}
async function seedTag(slug: string, frameIndex: number, teamSlug: string | null, authorId: string) {
  const id = 'tag-' + randomUUID().slice(0, 8);
  await getDb().insert(tags).values({ id, replaySlug: slug, frameIndex, userId: authorId, authorToken: 'kbx_author', authorName: 'A', comment: 'gg' });
  if (teamSlug) await getDb().insert(tagTeamScope).values({ tagId: id, teamSlug });
  return id;
}

beforeEach(() => vi.mocked(auth).mockReset());

describe('B113 share-token authorization', () => {
  it('mints a verifiable token for a teammate who can see the team-scoped tag', async () => {
    const a = await seedUser(); const b = await seedUser();
    const team = await seedTeam(a, [a, b]);
    const slug = await seedReplay(a);
    await getDb().insert(replayTeamShares).values({ replaySlug: slug, teamSlug: team, sharedBy: a });
    const tagId = await seedTag(slug, 5, team, a);

    const res = await call(slug, { frameIndex: 5, tagId }, b);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(verifyMoment(body.token)).toEqual({ slug, frameIndex: 5, tagId });
    expect(body.url).toContain('?f=6&t=');
  });

  it('403s a non-member (cannot see the team-scoped tag)', async () => {
    const a = await seedUser(); const outsider = await seedUser();
    const team = await seedTeam(a, [a]);
    const slug = await seedReplay(a);
    await getDb().insert(replayTeamShares).values({ replaySlug: slug, teamSlug: team, sharedBy: a });
    const tagId = await seedTag(slug, 2, team, a);
    expect((await call(slug, { frameIndex: 2, tagId }, outsider)).status).toBe(403);
  });

  it('403s anonymous for a team-scoped tag', async () => {
    const a = await seedUser();
    const team = await seedTeam(a, [a]);
    const slug = await seedReplay(a);
    const tagId = await seedTag(slug, 0, team, a);
    expect((await call(slug, { frameIndex: 0, tagId }, null)).status).toBe(403);
  });

  it('lets the author share their own personal tag', async () => {
    const a = await seedUser();
    const slug = await seedReplay(a);
    const tagId = await seedTag(slug, 3, null, a); // personal, author a
    expect((await call(slug, { frameIndex: 3, tagId }, a)).status).toBe(200);
  });

  it('400 on missing input; 404 when the tag is not on the claimed frame', async () => {
    const a = await seedUser();
    const slug = await seedReplay(a);
    const tagId = await seedTag(slug, 1, null, a);
    expect((await call(slug, { tagId }, a)).status).toBe(400);
    expect((await call(slug, { frameIndex: 99, tagId }, a)).status).toBe(404);
  });
});
