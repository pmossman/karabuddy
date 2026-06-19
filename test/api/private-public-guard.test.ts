import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PATCH } from '@/app/api/replays/[slug]/route';
import { getDb } from '@/lib/db';
import { replays } from '@/lib/schema';
import { eq } from 'drizzle-orm';

// B170 / ADR 0010: a private (encrypted) replay can never be made public — that
// would expose ciphertext + the metadata floor on the stranger-facing browser —
// nor take a plaintext displayName/labels (those live in the encrypted summary).

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
beforeEach(() => vi.mocked(auth).mockReset());

async function seedReplay(opts: { encrypted: boolean }) {
  const slug = randomUUID().slice(0, 8);
  const ownerToken = `kbx_${randomUUID()}`;
  await getDb().insert(replays).values({
    slug, gameId: randomUUID(), ownerToken,
    players: opts.encrypted ? [] : [{ username: 'A' }],
    payloadBlobUrl: `https://blob.test/${slug}.json`,
    encrypted: opts.encrypted,
    ...(opts.encrypted ? { teamKeyId: 'kid1', encryptedSummary: '{}' } : {}),
  });
  return { slug, ownerToken };
}
const patch = (slug: string, ownerToken: string, body: any) =>
  PATCH(new Request('http://t', { method: 'PATCH', headers: { 'X-Install-Token': ownerToken }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ slug }) });

describe('PATCH /api/replays/[slug] — private-replay guards', () => {
  it('rejects making an encrypted replay public', async () => {
    const { slug, ownerToken } = await seedReplay({ encrypted: true });
    const res = await patch(slug, ownerToken, { public: true });
    expect(res.status).toBe(400);
    const [row] = await getDb().select().from(replays).where(eq(replays.slug, slug));
    expect(row.publicAt).toBeNull();
  });

  it('rejects plaintext displayName/labels on an encrypted replay (would leak)', async () => {
    const { slug, ownerToken } = await seedReplay({ encrypted: true });
    expect((await patch(slug, ownerToken, { displayName: 'My deck tech' })).status).toBe(400);
    expect((await patch(slug, ownerToken, { labels: ['secret'] })).status).toBe(400);
  });

  it('still lets a normal (plaintext) replay be made public', async () => {
    const { slug, ownerToken } = await seedReplay({ encrypted: false });
    const res = await patch(slug, ownerToken, { public: true });
    expect(res.status).toBe(200);
    const [row] = await getDb().select().from(replays).where(eq(replays.slug, slug));
    expect(row.publicAt).not.toBeNull();
  });
});
