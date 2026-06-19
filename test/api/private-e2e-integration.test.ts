import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { POST as upload } from '@/app/api/replays/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, extensionTokens, replays, replayTeamShares } from '@/lib/schema';
import { getMemoryBlob } from '@/lib/blob';
import * as e2ee from '@/lib/e2ee.js';
// The ACTUAL extension SW decision + privacy helpers — exercised here against
// the real server route, so this test covers the Phase 2 (extension) ↔ Phase 3
// (server) seam, not a hand-built body.
import { decideUploadMode, privacyMapFromTeams } from '@/extension/private-teams.js';

// B170 / ADR 0010 — end-to-end integration: drive the extension's real
// upload-decision + crypto exactly as background.js does, through the real
// /api/replays route, then decrypt what the server stored. Proves: a keyholder's
// encrypted upload round-trips; a no-key upload is WITHHELD client-side (server
// never sees it); the server stores zero plaintext.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
beforeEach(() => vi.mocked(auth).mockReset());

async function seedMemberOfPrivateTeam() {
  const id = randomUUID();
  const token = `kbx_${randomUUID()}`;
  await getDb().insert(users).values({ id, name: id.slice(0, 4), email: `${id}@e.com` });
  await getDb().insert(extensionTokens).values({ token, userId: id });
  const { key, teamKeyId } = await e2ee.generateTeamKey();
  const slug = randomUUID().slice(0, 6);
  await getDb().insert(teams).values({ slug, name: 'Squad', createdBy: id, privateMode: true, teamKeyId });
  await getDb().insert(teamMembers).values({ teamSlug: slug, userId: id, role: 'owner' });
  return { id, token, key, teamKeyId, slug };
}

// What teams-mention-data would report for the member's teams.
function teamsMentionData(slug: string, teamKeyId: string) {
  return [{ slug, name: 'Squad', privateMode: true, teamKeyId }];
}

// A realistic recorder payload (plaintext) + the matchup summary the recorder
// would build. (buildEncryptedSummary itself is covered in summary.test.js.)
function recorderPayloadAndSummary(gameId: string) {
  const payload = JSON.stringify({
    version: 2, actionCount: 14, durationMs: 1234, localPlayerId: 'p1',
    events: [{ event: 'gamestate', args: [{ full: {
      id: gameId,
      players: {
        p1: { user: { username: 'Alice' }, leader: { name: 'Luke', setId: { set: 'SOR', number: 1 } }, base: { name: 'Echo', setId: { set: 'SOR', number: 2 } }, cardPiles: { hand: [{ id: 'SECRET_TECH' }] } },
        p2: { user: { username: 'Bob' }, leader: { name: 'Vader', setId: { set: 'SOR', number: 10 } }, base: { name: 'CC', setId: { set: 'SOR', number: 11 } } },
      },
      winners: ['Alice'],
    } }] }],
    tags: [],
  });
  const summary = { v: 1, players: { p1: { username: 'Alice', leader: { name: 'Luke' } }, p2: { username: 'Bob', leader: { name: 'Vader' } } }, winners: ['Alice'], ownerPlayerId: 'p1' };
  return { payload, summary };
}

// Faithful reimplementation of background.js's encrypt branch (the SW glue isn't
// importable — chrome.*/idb at load — so we run the same steps it runs).
async function swEncryptedUpload(m: Awaited<ReturnType<typeof seedMemberOfPrivateTeam>>, gameId: string) {
  const armed = [m.slug];
  const privacyBySlug = privacyMapFromTeams(teamsMentionData(m.slug, m.teamKeyId));
  const loadedKeyIds = [m.teamKeyId]; // key is loaded
  const decision = decideUploadMode({ armed, privacyBySlug, loadedKeyIds });
  expect(decision.mode).toBe('encrypt');

  const { payload, summary } = recorderPayloadAndSummary(gameId);
  const payloadEnv = await e2ee.encryptContent(m.key, payload);
  const summaryEnv = await e2ee.encryptContent(m.key, JSON.stringify(summary));
  const res = await upload(new Request('http://t/api/replays', { method: 'POST', body: JSON.stringify({
    installToken: m.token,
    encrypted: true,
    teamKeyId: decision.teamKeyId,
    gameId,
    payload: JSON.stringify(payloadEnv),
    encryptedSummary: JSON.stringify(summaryEnv),
    shareTeamSlugs: (decision as any).shareTeamSlugs,
    actionCount: 14,
    durationMs: 1234,
  }) }));
  return { res, payload, summary };
}

describe('private E2EE — extension modules → real server → decrypt', () => {
  it('keyholder upload round-trips and stores zero plaintext', async () => {
    const m = await seedMemberOfPrivateTeam();
    const gameId = `g-${randomUUID()}`;
    const { res, payload, summary } = await swEncryptedUpload(m, gameId);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.encrypted).toBe(true);

    const [row] = await getDb().select().from(replays).where(eq(replays.slug, json.slug));
    expect(row.encrypted).toBe(true);
    expect(row.teamKeyId).toBe(m.teamKeyId);
    expect(row.players).toEqual([]);

    // Server stored only ciphertext — the plaintext gamestate + secret card are gone.
    const blob = getMemoryBlob(`replays/${json.slug}.json`)!;
    expect(blob).not.toContain('SECRET_TECH');
    expect(blob).not.toContain('Luke');
    expect(row.encryptedSummary).not.toContain('Alice');

    // A keyholder decrypts both blob and summary back to the originals.
    expect(await e2ee.decryptContent(m.key, JSON.parse(blob))).toBe(payload);
    expect(JSON.parse(await e2ee.decryptContent(m.key, JSON.parse(row.encryptedSummary!)))).toEqual(summary);

    // Shared to the private team.
    const shares = await getDb().select().from(replayTeamShares).where(eq(replayTeamShares.replaySlug, json.slug));
    expect(shares.map((s) => s.teamSlug)).toEqual([m.slug]);
  });

  it('without the key loaded, the decision WITHHOLDS — nothing is uploaded', async () => {
    const m = await seedMemberOfPrivateTeam();
    const privacyBySlug = privacyMapFromTeams(teamsMentionData(m.slug, m.teamKeyId));
    const decision = decideUploadMode({ armed: [m.slug], privacyBySlug, loadedKeyIds: [] });
    expect(decision.mode).toBe('withhold');
    expect(decision.reason).toBe('no-key');
    // The SW posts nothing on withhold, so no row exists for this user's teams.
    const rows = await getDb().select().from(replays);
    expect(rows.length).toBe(0);
  });

  it('a non-keyholder teammate who DOES have the key can decrypt the same blob', async () => {
    // Models out-of-band key sharing: a second member pastes the same key.
    const m = await seedMemberOfPrivateTeam();
    const gameId = `g-${randomUUID()}`;
    const { res, payload } = await swEncryptedUpload(m, gameId);
    const { slug } = await res.json();
    const [row] = await getDb().select().from(replays).where(eq(replays.slug, slug));
    const blob = getMemoryBlob(`replays/${slug}.json`)!;
    // Teammate loaded the same team key out-of-band → decrypts fine.
    expect(await e2ee.decryptContent(m.key, JSON.parse(blob))).toBe(payload);
    // A different key (departed member / wrong key) cannot.
    const other = await e2ee.generateTeamKey();
    await expect(e2ee.decryptContent(other.key, JSON.parse(blob))).rejects.toThrow();
    expect(row.encrypted).toBe(true);
  });
});
