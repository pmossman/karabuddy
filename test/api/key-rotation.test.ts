import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST as upload } from '@/app/api/replays/route';
import { GET as rotationManifest, POST as rotationFinalize } from '@/app/api/teams/[slug]/rotation-manifest/route';
import { POST as rewrap } from '@/app/api/replays/[slug]/rewrap/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, extensionTokens, replays, tags } from '@/lib/schema';
import { getMemoryBlob } from '@/lib/blob';
import * as e2ee from '@/lib/e2ee.js';
import { eq } from 'drizzle-orm';

// B170 / ADR 0010 — forward-only key rotation. The owner's browser re-wraps every
// encrypted replay (payload + summary + encrypted tag comments) from the old team
// key to a new one (in the extension — the server never sees a key), POSTs the
// re-wrapped envelopes to /rewrap, then flips the team to the new kid. These
// tests drive the SERVER side with REAL crypto (rewrap done here via e2ee.rewrapKey
// to mimic the extension), asserting the server stores ciphertext under the new
// key, gates on ownership + kid, and only flips once rotation is complete.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const as = (userId: string | null) =>
  vi.mocked(auth).mockResolvedValue(userId ? ({ user: { id: userId } } as any) : (null as any));
beforeEach(() => vi.mocked(auth).mockReset());

async function seedUser() {
  const id = randomUUID();
  const token = `kbx_${randomUUID()}`;
  await getDb().insert(users).values({ id, name: id.slice(0, 4), email: `${id}@e.com` });
  await getDb().insert(extensionTokens).values({ token, userId: id });
  return { id, token };
}
async function seedTeam(owner: string, members: string[], opts: { private?: boolean; teamKeyId?: string | null } = {}) {
  const slug = randomUUID().slice(0, 6);
  await getDb().insert(teams).values({
    slug, name: slug, createdBy: owner,
    privateMode: opts.private ?? false,
    teamKeyId: opts.teamKeyId ?? null,
  });
  await getDb().insert(teamMembers).values(members.map((u) => ({ teamSlug: slug, userId: u, role: u === owner ? 'owner' : 'member' })));
  return slug;
}

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

// Upload one encrypted replay under `key`/`teamKeyId`, shared to `team`.
async function uploadEncrypted(token: string, key: string, teamKeyId: string, team: string) {
  const summary = { v: 1, players: { p1: { username: 'Alice' } }, winners: ['Alice'] };
  const payloadEnv = await e2ee.encryptContent(key, JSON.stringify({ version: 2, events: [], secret: 'PLAINTEXT' }));
  const summaryEnv = await e2ee.encryptContent(key, JSON.stringify(summary));
  const body = {
    installToken: token, encrypted: true, teamKeyId, gameId: `g-${randomUUID()}`,
    payload: JSON.stringify(payloadEnv), encryptedSummary: JSON.stringify(summaryEnv),
    shareTeamSlugs: [team], actionCount: 10, durationMs: 1000,
  };
  const res = await upload(new Request('http://t/api/replays', { method: 'POST', body: JSON.stringify(body) }));
  const json = await res.json();
  expect(json.ok).toBe(true);
  return json.slug as string;
}

// Add an encrypted tag comment to a replay (under `key`), mimicking a web-authored
// private comment.
async function seedEncryptedTag(slug: string, token: string, key: string) {
  const id = `t-${randomUUID().slice(0, 8)}`;
  const env = await e2ee.encryptContent(key, 'nice double-block');
  await getDb().insert(tags).values({
    id, replaySlug: slug, frameIndex: 5, authorToken: token, authorName: 'Alice',
    comment: '', commentEncrypted: JSON.stringify(env),
  });
  return id;
}

// Re-wrap one manifest replay old→new key, exactly as the extension does, and POST
// it to /rewrap as the given owner.
async function rewrapAndPost(slug: string, manifestReplay: any, oldKey: string, newKey: string, newKid: string) {
  const blob = getMemoryBlob(`replays/${slug}.json`)!;
  const payload = JSON.stringify(await e2ee.rewrapKey(oldKey, newKey, JSON.parse(blob)));
  const encryptedSummary = JSON.stringify(await e2ee.rewrapKey(oldKey, newKey, JSON.parse(manifestReplay.encryptedSummary)));
  const tagsOut = [];
  for (const t of manifestReplay.tags) {
    tagsOut.push({ id: t.id, commentEncrypted: JSON.stringify(await e2ee.rewrapKey(oldKey, newKey, JSON.parse(t.commentEncrypted))) });
  }
  return rewrap(
    new Request(`http://t/api/replays/${slug}/rewrap`, { method: 'POST', body: JSON.stringify({ newTeamKeyId: newKid, payload, encryptedSummary, tags: tagsOut }) }),
    params(slug),
  );
}

describe('rotation manifest', () => {
  it('owner gets every encrypted replay under the current key + its encrypted tags', async () => {
    const o = await seedUser();
    const old = await e2ee.generateTeamKey();
    const team = await seedTeam(o.id, [o.id], { private: true, teamKeyId: old.teamKeyId });
    const slug = await uploadEncrypted(o.token, old.key, old.teamKeyId, team);
    const tagId = await seedEncryptedTag(slug, o.token, old.key);

    as(o.id);
    const body = await (await rotationManifest(new Request('http://t'), params(team))).json();
    expect(body.ok).toBe(true);
    expect(body.currentTeamKeyId).toBe(old.teamKeyId);
    expect(body.replays).toHaveLength(1);
    expect(body.replays[0].slug).toBe(slug);
    expect(body.replays[0].encryptedSummary).toBeTruthy();
    expect(body.replays[0].tags.map((t: any) => t.id)).toEqual([tagId]);
  });

  it('is owner-only', async () => {
    const o = await seedUser();
    const m = await seedUser();
    const { teamKeyId } = await e2ee.generateTeamKey();
    const team = await seedTeam(o.id, [o.id, m.id], { private: true, teamKeyId });
    as(m.id);
    expect((await rotationManifest(new Request('http://t'), params(team))).status).toBe(403);
  });

  it('rejects a non-private team', async () => {
    const o = await seedUser();
    const team = await seedTeam(o.id, [o.id], { private: false });
    as(o.id);
    expect((await rotationManifest(new Request('http://t'), params(team))).status).toBe(400);
  });
});

describe('rewrap + finalize — full rotation', () => {
  it('re-wraps a replay under the new key, then the team flips; old key no longer decrypts', async () => {
    const o = await seedUser();
    const old = await e2ee.generateTeamKey();
    const neu = await e2ee.generateTeamKey();
    const team = await seedTeam(o.id, [o.id], { private: true, teamKeyId: old.teamKeyId });
    const slug = await uploadEncrypted(o.token, old.key, old.teamKeyId, team);
    const tagId = await seedEncryptedTag(slug, o.token, old.key);

    as(o.id);
    const manifest = await (await rotationManifest(new Request('http://t'), params(team))).json();

    // Flip BEFORE re-wrapping → refused (rotation incomplete).
    const early = await rotationFinalize(new Request('http://t', { method: 'POST', body: JSON.stringify({ newTeamKeyId: neu.teamKeyId }) }), params(team));
    expect(early.status).toBe(409);

    // Re-wrap the one replay.
    const rw = await rewrapAndPost(slug, manifest.replays[0], old.key, neu.key, neu.teamKeyId);
    expect(rw.status).toBe(200);

    // Replay now under the new kid; the stored blob + summary + tag decrypt under
    // the NEW key, and the OLD key is rejected.
    const [row] = await getDb().select().from(replays).where(eq(replays.slug, slug));
    expect(row.teamKeyId).toBe(neu.teamKeyId);
    const blob = getMemoryBlob(`replays/${slug}.json`)!;
    const payload = JSON.parse(await e2ee.decryptContent(neu.key, JSON.parse(blob)));
    expect(payload.secret).toBe('PLAINTEXT');
    await expect(e2ee.decryptContent(old.key, JSON.parse(blob))).rejects.toThrow();
    const summary = JSON.parse(await e2ee.decryptContent(neu.key, JSON.parse(row.encryptedSummary!)));
    expect(summary.players.p1.username).toBe('Alice');
    const [tag] = await getDb().select().from(tags).where(eq(tags.id, tagId));
    expect(await e2ee.decryptContent(neu.key, JSON.parse(tag.commentEncrypted!))).toBe('nice double-block');

    // Now the flip succeeds; the team is on the new key.
    const flip = await rotationFinalize(new Request('http://t', { method: 'POST', body: JSON.stringify({ newTeamKeyId: neu.teamKeyId }) }), params(team));
    expect(flip.status).toBe(200);
    const [t] = await getDb().select().from(teams).where(eq(teams.slug, team));
    expect(t.teamKeyId).toBe(neu.teamKeyId);
    expect(t.privateMode).toBe(true);

    // The manifest tracks the team's CURRENT key: it now reports the new kid,
    // and the replay (under the new kid) is listed there — re-rotating later
    // would re-wrap from the new key forward. (Resumability mid-rotation comes
    // from the team still being on the OLD kid until the flip — see the
    // 409-before-rewrap step above.)
    const after = await (await rotationManifest(new Request('http://t'), params(team))).json();
    expect(after.currentTeamKeyId).toBe(neu.teamKeyId);
    expect(after.replays).toHaveLength(1);
  });

  it('rejects an envelope NOT wrapped under newTeamKeyId', async () => {
    const o = await seedUser();
    const old = await e2ee.generateTeamKey();
    const neu = await e2ee.generateTeamKey();
    const team = await seedTeam(o.id, [o.id], { private: true, teamKeyId: old.teamKeyId });
    const slug = await uploadEncrypted(o.token, old.key, old.teamKeyId, team);
    as(o.id);

    // Submit the still-OLD-kid payload as if it were re-wrapped → kid check fails.
    const blob = getMemoryBlob(`replays/${slug}.json`)!;
    const res = await rewrap(
      new Request('http://t', { method: 'POST', body: JSON.stringify({ newTeamKeyId: neu.teamKeyId, payload: blob, encryptedSummary: blob, tags: [] }) }),
      params(slug),
    );
    expect(res.status).toBe(400);
  });

  it('finalize rejects rotating onto a key another team already uses', async () => {
    const o = await seedUser();
    const old = await e2ee.generateTeamKey();
    const neu = await e2ee.generateTeamKey();
    const teamA = await seedTeam(o.id, [o.id], { private: true, teamKeyId: old.teamKeyId });
    await seedTeam(o.id, [o.id], { private: true, teamKeyId: neu.teamKeyId }); // another team already uses neu
    as(o.id);
    const res = await rotationFinalize(new Request('http://t', { method: 'POST', body: JSON.stringify({ newTeamKeyId: neu.teamKeyId }) }), params(teamA));
    expect(res.status).toBe(409);
  });

  it('rewrap is owner-only on a team the replay is shared with', async () => {
    const o = await seedUser();
    const stranger = await seedUser();
    const old = await e2ee.generateTeamKey();
    const neu = await e2ee.generateTeamKey();
    const team = await seedTeam(o.id, [o.id], { private: true, teamKeyId: old.teamKeyId });
    const slug = await uploadEncrypted(o.token, old.key, old.teamKeyId, team);
    const manifestReplay = { encryptedSummary: getMemoryBlob(`replays/${slug}.json`), tags: [] };

    as(stranger.id); // not an owner of any team this replay is shared with
    const payload = JSON.stringify(await e2ee.rewrapKey(old.key, neu.key, JSON.parse(getMemoryBlob(`replays/${slug}.json`)!)));
    const res = await rewrap(
      new Request('http://t', { method: 'POST', body: JSON.stringify({ newTeamKeyId: neu.teamKeyId, payload, encryptedSummary: payload, tags: [] }) }),
      params(slug),
    );
    expect(res.status).toBe(403);
  });
});
