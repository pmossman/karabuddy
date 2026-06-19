import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST as upload } from '@/app/api/replays/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, extensionTokens, replays, replayTeamShares } from '@/lib/schema';
import { getMemoryBlob } from '@/lib/blob';
import * as e2ee from '@/lib/e2ee.js';
import { eq } from 'drizzle-orm';

// B170 / ADR 0010, Phase 3 (server backbone): the encrypted upload path stores
// ciphertext + summary + flag + non-secret kid, does NO decode/extract/stats,
// keeps players=[], and enforces (metadata-only) that an encrypted replay only
// shares into the matching private team — and a plaintext replay never leaks
// into a private team.

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

const post = (body: any) =>
  upload(new Request('http://t/api/replays', { method: 'POST', body: JSON.stringify(body) }));

// Build an encrypted upload body the way the extension SW will.
async function encBody(token: string, key: string, teamKeyId: string, shareTeamSlugs: string[], over: any = {}) {
  const summary = { v: 1, players: { p1: { username: 'Alice', leader: { name: 'Luke' } } }, winners: ['Alice'] };
  const payloadEnv = await e2ee.encryptContent(key, JSON.stringify({ version: 2, events: [], secret: 'PLAINTEXT_GAMESTATE' }));
  const summaryEnv = await e2ee.encryptContent(key, JSON.stringify(summary));
  return {
    installToken: token,
    encrypted: true,
    teamKeyId,
    gameId: over.gameId ?? `g-${randomUUID()}`,
    payload: JSON.stringify(payloadEnv),
    encryptedSummary: JSON.stringify(summaryEnv),
    shareTeamSlugs,
    actionCount: over.actionCount ?? 12,
    durationMs: 1000,
  };
}

describe('encrypted upload — happy path', () => {
  it('stores ciphertext + summary + flag + kid, no plaintext identity, and shares to the private team', async () => {
    const u = await seedUser();
    const { key, teamKeyId } = await e2ee.generateTeamKey();
    const team = await seedTeam(u.id, [u.id], { private: true, teamKeyId });

    const res = await post(await encBody(u.token, key, teamKeyId, [team]));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.encrypted).toBe(true);

    const [row] = await getDb().select().from(replays).where(eq(replays.slug, json.slug));
    expect(row.encrypted).toBe(true);
    expect(row.teamKeyId).toBe(teamKeyId);
    expect(row.players).toEqual([]); // no plaintext identity
    expect(row.match).toBeNull();
    expect(row.winners).toBeNull();
    expect(row.encryptedSummary).toBeTruthy();

    // The stored blob is ciphertext — the plaintext gamestate never lands.
    const blob = getMemoryBlob(`replays/${json.slug}.json`)!;
    expect(blob).not.toContain('PLAINTEXT_GAMESTATE');
    // The summary on the row decrypts back for a keyholder, and carries no
    // plaintext on the row itself.
    expect(row.encryptedSummary).not.toContain('Alice');
    const summary = JSON.parse(await e2ee.decryptContent(key, JSON.parse(row.encryptedSummary!)));
    expect(summary.players.p1.username).toBe('Alice');

    // Shared to the private team.
    const shares = await getDb().select().from(replayTeamShares).where(eq(replayTeamShares.replaySlug, json.slug));
    expect(shares.map((s) => s.teamSlug)).toEqual([team]);
  });

  it('periodic snapshots overwrite one row (per gameId+owner), stale guard honored', async () => {
    const u = await seedUser();
    const { key, teamKeyId } = await e2ee.generateTeamKey();
    const team = await seedTeam(u.id, [u.id], { private: true, teamKeyId });
    const gameId = `g-${randomUUID()}`;

    const r1 = await (await post(await encBody(u.token, key, teamKeyId, [team], { gameId, actionCount: 20 }))).json();
    const r2 = await (await post(await encBody(u.token, key, teamKeyId, [team], { gameId, actionCount: 40 }))).json();
    expect(r2.slug).toBe(r1.slug); // same row
    const rows = await getDb().select().from(replays).where(eq(replays.gameId, gameId));
    expect(rows.length).toBe(1);
    expect(rows[0].actionCount).toBe(40);

    // A late, smaller snapshot is rejected as stale.
    const r3 = await (await post(await encBody(u.token, key, teamKeyId, [team], { gameId, actionCount: 30 }))).json();
    expect(r3.staleSnapshot).toBe(true);
    const [after] = await getDb().select().from(replays).where(eq(replays.gameId, gameId));
    expect(after.actionCount).toBe(40);
  });
});

describe('encrypted upload — enforcement (defense-in-depth)', () => {
  it('rejects sharing into a NON-private team', async () => {
    const u = await seedUser();
    const { key, teamKeyId } = await e2ee.generateTeamKey();
    const pub = await seedTeam(u.id, [u.id], { private: false });
    const res = await post(await encBody(u.token, key, teamKeyId, [pub]));
    expect(res.status).toBe(400);
  });

  it('rejects when the kid does not match the team key', async () => {
    const u = await seedUser();
    const { key } = await e2ee.generateTeamKey();
    const other = await e2ee.generateTeamKey();
    const team = await seedTeam(u.id, [u.id], { private: true, teamKeyId: other.teamKeyId });
    // Upload encrypted under `key` (kid != team's other.teamKeyId).
    const res = await post(await encBody(u.token, key, await e2ee.teamKeyId(key), [team]));
    expect(res.status).toBe(400);
  });

  it('rejects a team the uploader is not a member of', async () => {
    const u = await seedUser();
    const stranger = await seedUser();
    const { key, teamKeyId } = await e2ee.generateTeamKey();
    const team = await seedTeam(stranger.id, [stranger.id], { private: true, teamKeyId });
    const res = await post(await encBody(u.token, key, teamKeyId, [team]));
    expect(res.status).toBe(403);
  });

  it('requires teamKeyId, gameId, encryptedSummary, and a target team', async () => {
    const u = await seedUser();
    expect((await post({ installToken: u.token, encrypted: true, payload: '{}' })).status).toBe(400);
  });
});

describe('plaintext upload into a private team — server backstop', () => {
  it('drops the private-team share (no plaintext leaks to the team)', async () => {
    const u = await seedUser();
    const { teamKeyId } = await e2ee.generateTeamKey();
    const priv = await seedTeam(u.id, [u.id], { private: true, teamKeyId });

    // Old/buggy extension sends a PLAINTEXT replay armed for the private team.
    const payload = JSON.stringify({
      version: 2, actionCount: 10, durationMs: 1000, localPlayerId: 'p1',
      events: [{ event: 'gamestate', args: [{ full: { id: `g-${randomUUID()}`, players: { p1: { user: { username: 'Alice' } }, p2: { user: { username: 'Bob' } } } } }] }],
      tags: [],
    });
    const res = await post({ installToken: u.token, payload, shareTeamSlugs: [priv] });
    const json = await res.json();
    expect(res.status).toBe(200); // the upload itself isn't rejected...
    // ...but the share into the private team is DROPPED (backstop).
    const shares = await getDb().select().from(replayTeamShares).where(eq(replayTeamShares.replaySlug, json.slug));
    expect(shares.length).toBe(0);
  });
});
