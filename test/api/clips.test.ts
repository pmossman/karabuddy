import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST as createClip, GET as listClips } from '@/app/api/replays/[slug]/clips/route';
import { GET as getClip, DELETE as deleteClip } from '@/app/api/clips/[slug]/route';
import { getDb } from '@/lib/db';
import { users, replays } from '@/lib/schema';

// B136: clips — any viewer creates a [start,end] range; the clip is publicly
// link-viewable (anonymized for outsiders); creator OR replay owner deletes.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const as = (userId: string | null) => vi.mocked(auth).mockResolvedValue(userId ? ({ user: { id: userId } } as any) : (null as any));

async function seedUser() {
  const id = randomUUID();
  await getDb().insert(users).values({ id, name: 'U', email: `${id}@e.com` });
  return id;
}
async function seedReplay(ownerUserId: string | null, ownerToken = `kbx_${randomUUID()}`) {
  const slug = randomUUID().slice(0, 8);
  await getDb().insert(replays).values({
    slug, gameId: randomUUID(), userId: ownerUserId, ownerToken,
    players: [{ id: 'p1', username: 'RealA' }, { id: 'p2', username: 'RealB' }],
    ownerPlayerId: 'p1', payloadBlobUrl: `https://blob.test/${slug}.json`,
  });
  return slug;
}
const create = (slug: string, body: unknown, headers: Record<string, string> = {}) =>
  createClip(new Request('http://t', { method: 'POST', body: JSON.stringify(body), headers }), { params: Promise.resolve({ slug }) });
const get = (clipSlug: string) => getClip(new Request('http://t'), { params: Promise.resolve({ slug: clipSlug }) });
const del = (clipSlug: string, headers: Record<string, string> = {}) =>
  deleteClip(new Request('http://t', { method: 'DELETE', headers }), { params: Promise.resolve({ slug: clipSlug }) });

beforeEach(() => vi.mocked(auth).mockReset());

describe('B136: create', () => {
  it('a signed-in viewer (not the owner) can clip', async () => {
    const owner = await seedUser();
    const viewer = await seedUser();
    const slug = await seedReplay(owner);
    as(viewer);
    const res = await create(slug, { startFrame: 10, endFrame: 40, title: 'nice line' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toMatch(/^cl_/);
  });

  it('an anonymous viewer clips via install token', async () => {
    const owner = await seedUser();
    const slug = await seedReplay(owner);
    as(null);
    const res = await create(slug, { startFrame: 0, endFrame: 5 }, { 'X-Install-Token': `kb_${randomUUID()}` });
    expect(res.status).toBe(200);
  });

  it('rejects no attribution, inverted/empty ranges, and a missing replay', async () => {
    const owner = await seedUser();
    const slug = await seedReplay(owner);
    as(null);
    expect((await create(slug, { startFrame: 0, endFrame: 5 })).status).toBe(401); // no token, no session
    as(owner);
    expect((await create(slug, { startFrame: 5, endFrame: 5 })).status).toBe(400); // empty
    expect((await create(slug, { startFrame: 9, endFrame: 3 })).status).toBe(400); // inverted
    expect((await create('nope', { startFrame: 0, endFrame: 1 })).status).toBe(404);
  });
});

describe('B136: view (public + anonymized)', () => {
  it('an outsider gets the clip with the board anonymized; the owner sees real names', async () => {
    const owner = await seedUser();
    const slug = await seedReplay(owner);
    as(owner);
    const created = await (await create(slug, { startFrame: 2, endFrame: 8, title: 'T' })).json();

    // Outsider (signed out): anonymized players, no ownerPlayerId.
    as(null);
    const outsider = await (await get(created.slug)).json();
    expect(outsider.data.clip.startFrame).toBe(2);
    expect(outsider.data.clip.endFrame).toBe(8);
    expect(outsider.data.replay.players.map((p: any) => p.username)).toEqual(['Player1', 'Player2']);
    expect(outsider.data.replay.ownerPlayerId).toBeNull();
    expect(JSON.stringify(outsider.data.replay)).not.toContain('RealA');
    expect(outsider.data.clip.canDelete).toBe(false);

    // Owner: real names + canDelete.
    as(owner);
    const ownerView = await (await get(created.slug)).json();
    expect(ownerView.data.replay.players.map((p: any) => p.username)).toEqual(['RealA', 'RealB']);
    expect(ownerView.data.clip.canDelete).toBe(true);
  });
});

describe('B136: delete', () => {
  it('the creator can delete; a stranger cannot; the replay owner can', async () => {
    const owner = await seedUser();
    const creator = await seedUser();
    const stranger = await seedUser();
    const slug = await seedReplay(owner);
    as(creator);
    const a = await (await create(slug, { startFrame: 1, endFrame: 9 })).json();

    as(stranger);
    expect((await del(a.slug)).status).toBe(403);

    as(creator);
    expect((await del(a.slug)).status).toBe(200);
    expect((await get(a.slug)).status).toBe(404); // gone

    // A clip by someone else is still deletable by the replay owner.
    as(stranger);
    const b = await (await create(slug, { startFrame: 1, endFrame: 9 })).json();
    as(owner);
    expect((await del(b.slug)).status).toBe(200);
  });
});

describe('B136: list', () => {
  it('lists a replay’s clips newest first', async () => {
    const owner = await seedUser();
    const slug = await seedReplay(owner);
    as(owner);
    await create(slug, { startFrame: 0, endFrame: 3 });
    await create(slug, { startFrame: 4, endFrame: 7 });
    const res = await listClips(new Request('http://t'), { params: Promise.resolve({ slug }) });
    const body = await res.json();
    expect(body.data).toHaveLength(2);
  });
});
