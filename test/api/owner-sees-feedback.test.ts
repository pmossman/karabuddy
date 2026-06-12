import { describe, expect, it, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { GET as getTags, POST as postTag } from '@/app/api/replays/[slug]/tags/route';
import { POST as postShareToken } from '@/app/api/replays/[slug]/share-token/route';
import { getDb } from '@/lib/db';
import { users, replays } from '@/lib/schema';

// B131: the replay OWNER sees every tag on their own replay. The motivating
// case: a friend reviews your replay while signed out — their comments land
// personal-scoped (anonymous authors can never scope to teams) and were
// invisible to the very person they reviewed.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const mockedAuth = vi.mocked(auth);

async function seedUser(name: string) {
  const id = randomUUID();
  await getDb().insert(users).values({ id, name, email: `${id}@e.com` });
  return id;
}
async function seedReplay(slug: string, userId: string | null, ownerToken: string) {
  await getDb().insert(replays).values({
    slug, gameId: randomUUID(), userId, ownerToken,
    players: [{ username: 'A' }, { username: 'B' }], payloadBlobUrl: `https://blob.test/${slug}.json`,
  });
}
const as = (userId: string | null) =>
  mockedAuth.mockResolvedValue(userId ? ({ user: { id: userId, name: 'u' } } as any) : null);
const post = (slug: string, body: unknown) =>
  postTag(new Request('http://test', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ slug }),
  });
const get = (slug: string, installToken?: string) =>
  getTags(new Request('http://test', { headers: installToken ? { 'x-install-token': installToken } : {} }), {
    params: Promise.resolve({ slug }),
  });

beforeEach(() => mockedAuth.mockReset());

describe('B131: replay owner sees all tags on their replay', () => {
  it('an anonymous visitor’s personal comment is visible to the owner, not to a bystander', async () => {
    const owner = await seedUser('Owner');
    const slug = `rep-${randomUUID().slice(0, 8)}`;
    await seedReplay(slug, owner, `kbx_${randomUUID()}`);

    // Friend, signed out, comments via their install token → personal scope.
    as(null);
    const friendToken = `kb_${randomUUID()}`;
    const posted = await (await post(slug, { installToken: friendToken, authorName: 'anon-pal', frameIndex: 7, comment: 'play Bix here' })).json();
    expect(posted.ok).toBe(true);
    expect(posted.scope).toEqual([]); // anonymous → personal

    // Owner sees it.
    as(owner);
    const ownerView = await (await get(slug)).json();
    expect(ownerView.data.map((t: any) => t.comment)).toContain('play Bix here');

    // A different signed-in user does not.
    const bystander = await seedUser('Bystander');
    as(bystander);
    const bystanderView = await (await get(slug)).json();
    expect(bystanderView.data).toHaveLength(0);

    // The friend still sees their own comment (by install token).
    as(null);
    const friendView = await (await get(slug, friendToken)).json();
    expect(friendView.data.map((t: any) => t.comment)).toContain('play Bix here');
  });

  it('an ANONYMOUS owner (unclaimed install token) also sees feedback on their replay', async () => {
    const slug = `rep-${randomUUID().slice(0, 8)}`;
    const ownerToken = `kbx_${randomUUID()}`;
    await seedReplay(slug, null, ownerToken);

    as(null);
    const friendToken = `kb_${randomUUID()}`;
    await post(slug, { installToken: friendToken, authorName: 'anon-pal', frameIndex: 3, comment: 'kill the token' });

    as(null);
    const ownerView = await (await get(slug, ownerToken)).json();
    expect(ownerView.data.map((t: any) => t.comment)).toContain('kill the token');
  });

  it('the owner can mint a share token for the anonymous feedback; a bystander cannot', async () => {
    const owner = await seedUser('Owner2');
    const slug = `rep-${randomUUID().slice(0, 8)}`;
    await seedReplay(slug, owner, `kbx_${randomUUID()}`);

    as(null);
    const posted = await (await post(slug, { installToken: `kb_${randomUUID()}`, authorName: 'anon-pal', frameIndex: 4, comment: 'nice line' })).json();

    const mint = (body: unknown) =>
      postShareToken(new Request('http://test', { method: 'POST', body: JSON.stringify(body) }), {
        params: Promise.resolve({ slug }),
      });

    as(owner);
    const ok = await mint({ tagId: posted.id, frameIndex: 4 });
    expect(ok.status).toBe(200);

    const bystander = await seedUser('Bystander2');
    as(bystander);
    const denied = await mint({ tagId: posted.id, frameIndex: 4 });
    expect(denied.status).toBe(403);
  });
});
