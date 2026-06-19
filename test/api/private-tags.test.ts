import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST as upload } from '@/app/api/replays/route';
import { POST as postTag, GET as getTags } from '@/app/api/replays/[slug]/tags/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, extensionTokens, tags } from '@/lib/schema';
import * as e2ee from '@/lib/e2ee.js';
import { eq } from 'drizzle-orm';

// B170 / ADR 0010: web-authored tags on a private replay. The comment text is
// encrypted client-side (via the extension bridge) and posted as an envelope;
// the server stores ciphertext, keeps the plaintext comment empty, drops
// mentions, and serves the ciphertext back to entitled members to decrypt.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
beforeEach(() => vi.mocked(auth).mockReset());

async function seedUser() {
  const id = randomUUID();
  const token = `kbx_${randomUUID()}`;
  await getDb().insert(users).values({ id, name: id.slice(0, 4), email: `${id}@e.com` });
  await getDb().insert(extensionTokens).values({ token, userId: id });
  return { id, token };
}

async function makeEncryptedReplay(u: { id: string; token: string }) {
  const { key, teamKeyId } = await e2ee.generateTeamKey();
  const slug = randomUUID().slice(0, 6);
  await getDb().insert(teams).values({ slug, name: slug, createdBy: u.id, privateMode: true, teamKeyId });
  await getDb().insert(teamMembers).values({ teamSlug: slug, userId: u.id, role: 'owner' });
  const payloadEnv = await e2ee.encryptContent(key, JSON.stringify({ version: 2, events: [] }));
  const summaryEnv = await e2ee.encryptContent(key, JSON.stringify({ v: 1, players: {} }));
  const res = await upload(new Request('http://t/api/replays', { method: 'POST', body: JSON.stringify({
    installToken: u.token, encrypted: true, teamKeyId, gameId: `g-${randomUUID()}`,
    payload: JSON.stringify(payloadEnv), encryptedSummary: JSON.stringify(summaryEnv),
    shareTeamSlugs: [slug], actionCount: 10, durationMs: 1000,
  }) }));
  const { slug: replaySlug } = await res.json();
  return { replaySlug, key };
}

describe('encrypted tags', () => {
  it('stores ciphertext comment (empty plaintext, no mentions) and serves it back to a member', async () => {
    const u = await seedUser();
    const { replaySlug, key } = await makeEncryptedReplay(u);

    const commentEnv = await e2ee.encryptContent(key, 'they over-committed to the board here');
    const res = await postTag(new Request(`http://t/api/replays/${replaySlug}/tags`, {
      method: 'POST',
      body: JSON.stringify({ installToken: u.token, authorName: 'reviewer', frameIndex: 4, commentEncrypted: JSON.stringify(commentEnv) }),
    }), { params: Promise.resolve({ slug: replaySlug }) });
    expect((await res.json()).ok).toBe(true);

    // Stored: ciphertext set, plaintext blank, no plaintext leak on the row.
    const [row] = await getDb().select().from(tags).where(eq(tags.replaySlug, replaySlug));
    expect(row.comment).toBe('');
    expect(row.commentEncrypted).toBeTruthy();
    expect(row.mentions).toBeNull();
    expect(JSON.stringify(row)).not.toContain('over-committed');

    // Served back to the entitled member, who decrypts it.
    const gres = await getTags(new Request(`http://t/api/replays/${replaySlug}/tags`, { headers: { 'x-install-token': u.token } }), { params: Promise.resolve({ slug: replaySlug }) });
    const { data } = await gres.json();
    expect(data.length).toBe(1);
    expect(data[0].comment).toBe('');
    expect(data[0].commentEncrypted).toBeTruthy();
    expect(await e2ee.decryptContent(key, JSON.parse(data[0].commentEncrypted))).toBe('they over-committed to the board here');
  });

  it('rejects a plaintext-only tag on an encrypted replay (must send commentEncrypted)', async () => {
    const u = await seedUser();
    const { replaySlug } = await makeEncryptedReplay(u);
    const res = await postTag(new Request(`http://t/api/replays/${replaySlug}/tags`, {
      method: 'POST',
      body: JSON.stringify({ installToken: u.token, authorName: 'reviewer', frameIndex: 4, comment: 'oops plaintext' }),
    }), { params: Promise.resolve({ slug: replaySlug }) });
    expect(res.status).toBe(400);
  });
});
