import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PATCH as patchTag, DELETE as deleteTag } from '@/app/api/replays/[slug]/tags/[id]/route';
import { PATCH as patchReplay, DELETE as deleteReplay } from '@/app/api/replays/[slug]/route';
import { getDb } from '@/lib/db';
import { replays, tags } from '@/lib/schema';
import { eq } from 'drizzle-orm';

// B79: authorization coverage for tag + replay mutation. Edit = author only;
// tag-delete = author OR replay owner; replay mutate = replay owner only.
// Ownership is exercised via the X-Install-Token header (anonymous owner) so
// no session mock is needed beyond returning null.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
beforeEach(() => vi.mocked(auth).mockResolvedValue(null as any));

async function seedReplay(slug: string, ownerToken: string) {
  await getDb().insert(replays).values({
    slug, gameId: randomUUID(), ownerToken,
    players: [{ username: 'A' }], payloadBlobUrl: `https://blob.test/${slug}.json`,
  });
}
async function seedTag(slug: string, id: string, authorToken: string) {
  await getDb().insert(tags).values({ id, replaySlug: slug, frameIndex: 0, authorToken, authorName: 'A', comment: 'orig' });
}
const req = (token: string | null, body?: unknown) =>
  new Request('http://test', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-install-token': token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const tagParams = (slug: string, id: string) => ({ params: Promise.resolve({ slug, id }) });
const slugParams = (slug: string) => ({ params: Promise.resolve({ slug }) });

describe('PATCH /tags/:id — edit is author-only', () => {
  it('the author (by install token) can edit', async () => {
    await seedReplay('r1', 'kbx_owner');
    await seedTag('r1', 't1', 'kbx_author');
    const res = await patchTag(req('kbx_author', { comment: 'edited' }), tagParams('r1', 't1'));
    expect(res.status).toBe(200);
    const [row] = await getDb().select().from(tags).where(eq(tags.id, 't1'));
    expect(row.comment).toBe('edited');
  });
  it('a non-author is forbidden', async () => {
    await seedReplay('r2', 'kbx_owner');
    await seedTag('r2', 't2', 'kbx_author');
    expect((await patchTag(req('kbx_stranger', { comment: 'x' }), tagParams('r2', 't2'))).status).toBe(403);
  });
  it('even the replay owner cannot edit someone else’s tag text', async () => {
    await seedReplay('r3', 'kbx_owner');
    await seedTag('r3', 't3', 'kbx_author');
    expect((await patchTag(req('kbx_owner', { comment: 'x' }), tagParams('r3', 't3'))).status).toBe(403);
  });
  it('404 for an unknown tag', async () => {
    await seedReplay('r4', 'kbx_owner');
    expect((await patchTag(req('kbx_owner', { comment: 'x' }), tagParams('r4', 'nope'))).status).toBe(404);
  });
});

describe('DELETE /tags/:id — author OR replay owner', () => {
  it('the tag author can delete', async () => {
    await seedReplay('d1', 'kbx_owner');
    await seedTag('d1', 'dt1', 'kbx_author');
    expect((await deleteTag(req('kbx_author'), tagParams('d1', 'dt1'))).status).toBe(200);
    expect(await getDb().select().from(tags).where(eq(tags.id, 'dt1'))).toHaveLength(0);
  });
  it('the replay owner can delete another user’s tag', async () => {
    await seedReplay('d2', 'kbx_owner');
    await seedTag('d2', 'dt2', 'kbx_author');
    expect((await deleteTag(req('kbx_owner'), tagParams('d2', 'dt2'))).status).toBe(200);
  });
  it('a stranger cannot delete', async () => {
    await seedReplay('d3', 'kbx_owner');
    await seedTag('d3', 'dt3', 'kbx_author');
    expect((await deleteTag(req('kbx_stranger'), tagParams('d3', 'dt3'))).status).toBe(403);
  });
});

describe('PATCH /replays/:slug — owner only', () => {
  it('owner can rename (displayName); non-owner is forbidden', async () => {
    await seedReplay('p1', 'kbx_owner');
    expect((await patchReplay(req('kbx_stranger', { displayName: 'Theirs' }), slugParams('p1'))).status).toBe(403);
    expect((await patchReplay(req('kbx_owner', { displayName: 'My Game' }), slugParams('p1'))).status).toBe(200);
    const [row] = await getDb().select().from(replays).where(eq(replays.slug, 'p1'));
    expect(row.displayName).toBe('My Game');
  });
  it('cleans labels — trims, dedupes case-insensitively, caps at 20', async () => {
    await seedReplay('p2', 'kbx_owner');
    const labels = ['  Aggro  ', 'aggro', 'Midrange', ...Array.from({ length: 30 }, (_, i) => `L${i}`)];
    await patchReplay(req('kbx_owner', { labels }), slugParams('p2'));
    const [row] = await getDb().select().from(replays).where(eq(replays.slug, 'p2'));
    const stored = row.labels as string[];
    expect(stored).toHaveLength(20);
    expect(stored[0]).toBe('Aggro'); // trimmed, first casing kept
    expect(stored.filter((l) => l.toLowerCase() === 'aggro')).toHaveLength(1); // deduped
  });
  it('400 when there is nothing to update', async () => {
    await seedReplay('p3', 'kbx_owner');
    expect((await patchReplay(req('kbx_owner', {}), slugParams('p3'))).status).toBe(400);
  });
});

describe('DELETE /replays/:slug — owner only (cascades tags)', () => {
  it('owner deletes the replay and its tags; non-owner forbidden', async () => {
    await seedReplay('x1', 'kbx_owner');
    await seedTag('x1', 'xt1', 'kbx_author');
    expect((await deleteReplay(req('kbx_stranger'), slugParams('x1'))).status).toBe(403);
    expect((await deleteReplay(req('kbx_owner'), slugParams('x1'))).status).toBe(200);
    expect(await getDb().select().from(replays).where(eq(replays.slug, 'x1'))).toHaveLength(0);
    expect(await getDb().select().from(tags).where(eq(tags.id, 'xt1'))).toHaveLength(0); // FK cascade
  });
});
