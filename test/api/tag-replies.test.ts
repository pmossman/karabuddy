import { describe, expect, it, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST as postTag } from '@/app/api/replays/[slug]/tags/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, replays, replayTeamShares, tags } from '@/lib/schema';
import { eq } from 'drizzle-orm';

// B78: one-level reply threading. A reply inherits the parent's frame + team
// scope and auto-@mentions the parent author; replies can't be replied to.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const mockedAuth = vi.mocked(auth);

async function seedUser(name: string) {
  const id = randomUUID();
  await getDb().insert(users).values({ id, name, email: `${id}@e.com` });
  return id;
}
async function seedTeam(slug: string, members: string[]) {
  const db = getDb();
  await db.insert(teams).values({ slug, name: slug, createdBy: members[0] });
  await db.insert(teamMembers).values(members.map((userId) => ({ teamSlug: slug, userId, role: 'member' })));
}
async function seedReplay(slug: string, userId: string) {
  await getDb().insert(replays).values({
    slug, gameId: randomUUID(), userId, ownerToken: `kbx_${randomUUID()}`,
    players: [{ username: 'A' }, { username: 'B' }], payloadBlobUrl: `https://blob.test/${slug}.json`,
  });
}
const as = (userId: string) => mockedAuth.mockResolvedValue({ user: { id: userId, name: userId.slice(0, 4) } } as any);
const post = (slug: string, body: unknown) =>
  postTag(new Request('http://test', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ slug }),
  });

beforeEach(() => mockedAuth.mockReset());

describe('POST /api/replays/:slug/tags — replies', () => {
  it('a reply inherits the parent frame + team scope and @mentions the parent author', async () => {
    const a = await seedUser('Alice');
    const b = await seedUser('Bob');
    await seedTeam('team-x', [a, b]);
    await seedReplay('rep-1', a);
    await getDb().insert(replayTeamShares).values({ replaySlug: 'rep-1', teamSlug: 'team-x', sharedBy: a });

    // Alice's top-level comment at frame 5, scoped to team-x.
    as(a);
    const parentRes = await post('rep-1', { installToken: 'kbx_a', authorName: 'Alice', frameIndex: 5, comment: 'tempo swing', teamSlugs: ['team-x'] });
    const parent = await parentRes.json();
    expect(parent.scope).toEqual(['team-x']);

    // Bob replies — sends frame 0, but it should anchor to the parent's frame 5.
    as(b);
    const replyRes = await post('rep-1', { installToken: 'kbx_b', authorName: 'Bob', frameIndex: 0, comment: 'good read', parentTagId: parent.id });
    const reply = await replyRes.json();
    expect(reply.ok).toBe(true);
    expect(reply.scope).toEqual(['team-x']); // inherited

    const [row] = await getDb().select().from(tags).where(eq(tags.id, reply.id));
    expect(row.parentTagId).toBe(parent.id);
    expect(row.frameIndex).toBe(5); // inherited from parent, not the sent 0
    expect((row.mentions as any).userIds).toContain(a); // auto-mention parent author
  });

  it('rejects a reply to a reply (one level only)', async () => {
    const a = await seedUser('A2');
    await seedReplay('rep-2', a);
    as(a);
    const parent = await (await post('rep-2', { installToken: 'kbx_a', authorName: 'A', frameIndex: 1, comment: 'p' })).json();
    const reply = await (await post('rep-2', { installToken: 'kbx_a', authorName: 'A', frameIndex: 1, comment: 'r', parentTagId: parent.id })).json();
    const res = await post('rep-2', { installToken: 'kbx_a', authorName: 'A', frameIndex: 1, comment: 'r2', parentTagId: reply.id });
    expect(res.status).toBe(400);
  });

  it('404s a reply to an unknown parent', async () => {
    const a = await seedUser('A3');
    await seedReplay('rep-3', a);
    as(a);
    const res = await post('rep-3', { installToken: 'kbx_a', authorName: 'A', frameIndex: 1, comment: 'r', parentTagId: 'nope' });
    expect(res.status).toBe(404);
  });
});
