import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';

// B81: POST /tags fires notifyMentions (Discord fan-out) after persisting.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/discordNotify', () => ({ notifyMentions: vi.fn(async () => []) }));

const { auth } = await import('@/auth');
const { notifyMentions } = await import('@/lib/discordNotify');
const { POST: postTag } = await import('@/app/api/replays/[slug]/tags/route');
const { getDb } = await import('@/lib/db');
const { users, replays } = await import('@/lib/schema');
const mockedNotify = vi.mocked(notifyMentions);

beforeEach(() => { vi.mocked(auth).mockReset(); mockedNotify.mockClear(); });

async function seedReplay(slug: string) {
  await getDb().insert(replays).values({
    slug, gameId: randomUUID(), ownerToken: `kbx_${randomUUID()}`,
    players: [{ username: 'A' }], payloadBlobUrl: `https://blob.test/${slug}.json`,
  });
}

it('calls notifyMentions with the tag mentions + frame after the write', async () => {
  const author = randomUUID();
  const mentioned = randomUUID();
  await getDb().insert(users).values([
    { id: author, name: 'Author', email: `${author}@e.com` },
    { id: mentioned, name: 'M', email: `${mentioned}@e.com` },
  ]);
  vi.mocked(auth).mockResolvedValue({ user: { id: author } } as any);
  await seedReplay('rn1');

  const req = new Request('http://t', {
    method: 'POST',
    body: JSON.stringify({ installToken: 'kbx_a', authorName: 'Author', frameIndex: 7, comment: 'hey @M', mentions: { userIds: [mentioned], teamSlugs: [] } }),
  });
  const res = await postTag(req, { params: Promise.resolve({ slug: 'rn1' }) });
  expect((await res.json()).ok).toBe(true);

  expect(mockedNotify).toHaveBeenCalledTimes(1);
  const arg = mockedNotify.mock.calls[0][0];
  expect(arg.mentions.userIds).toContain(mentioned);
  expect(arg.frameIndex).toBe(7);
  expect(arg.replaySlug).toBe('rn1');
  expect(arg.authorUserId).toBe(author);
});

it('does not fail the tag write if notifyMentions throws', async () => {
  mockedNotify.mockRejectedValueOnce(new Error('discord down'));
  vi.mocked(auth).mockResolvedValue(null as any);
  await seedReplay('rn2');
  const req = new Request('http://t', {
    method: 'POST',
    body: JSON.stringify({ installToken: 'kbx_b', authorName: 'Anon', frameIndex: 0, comment: 'x' }),
  });
  const res = await postTag(req, { params: Promise.resolve({ slug: 'rn2' }) });
  expect((await res.json()).ok).toBe(true); // tag still written despite the throw
});
