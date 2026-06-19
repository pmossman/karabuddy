import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { users, teams, replays, tags } from '@/lib/schema';
import * as e2ee from '@/lib/e2ee.js';

// B170 / ADR 0010, Phase 1: prove the additive private-teams migration
// (0029_private_teams) applies under pglite and the new columns round-trip with
// the right defaults. The api-suite beforeAll runs every migration, so a green
// run here also means the migration is well-formed. This is schema-level only —
// upload/serve wiring is Phase 3.

async function seedUser() {
  const db = getDb();
  const [u] = await db.insert(users).values({ name: 'lead' }).returning();
  return u;
}

describe('private-teams schema (migration 0029)', () => {
  it('teams default to non-private with no team key id; private mode stores only the non-secret id', async () => {
    const db = getDb();
    const u = await seedUser();

    const [plain] = await db.insert(teams).values({ slug: 'plain1', name: 'Plain', createdBy: u.id }).returning();
    expect(plain.privateMode).toBe(false);
    expect(plain.teamKeyId).toBeNull();

    // What a client would do: generate the key locally, send ONLY the id.
    const { key, teamKeyId } = await e2ee.generateTeamKey();
    const [priv] = await db
      .insert(teams)
      .values({ slug: 'priv1', name: 'Private', createdBy: u.id, privateMode: true, teamKeyId })
      .returning();
    expect(priv.privateMode).toBe(true);
    expect(priv.teamKeyId).toBe(teamKeyId);
    // The key itself is never persisted anywhere on the row.
    expect(JSON.stringify(priv)).not.toContain(key);
  });

  it('replays default to encrypted=false; an encrypted replay stores ciphertext summary + kid, no plaintext identity', async () => {
    const db = getDb();
    const u = await seedUser();
    const { key, teamKeyId } = await e2ee.generateTeamKey();

    // Plaintext replay — unchanged path.
    const [plain] = await db
      .insert(replays)
      .values({ slug: 'r-plain', gameId: 'g-plain', ownerToken: 'kbx_a', players: [{ id: 'p1', username: 'Alice' }], payloadBlobUrl: 'http://blob/x' })
      .returning();
    expect(plain.encrypted).toBe(false);
    expect(plain.teamKeyId).toBeNull();
    expect(plain.encryptedSummary).toBeNull();

    // Encrypted replay — server stores ONLY ciphertext + flag + kid. players=[]
    // (NOT NULL), match/decks/winners stay null.
    const summary = await e2ee.encryptContent(key, JSON.stringify({ leaders: ['Vader', 'Luke'], winner: 'p1' }));
    const [enc] = await db
      .insert(replays)
      .values({
        slug: 'r-enc',
        gameId: 'g-enc',
        ownerToken: 'kbx_b',
        players: [],
        payloadBlobUrl: 'http://blob/enc',
        encrypted: true,
        teamKeyId,
        encryptedSummary: JSON.stringify(summary),
      })
      .returning();
    expect(enc.encrypted).toBe(true);
    expect(enc.teamKeyId).toBe(teamKeyId);
    expect(enc.players).toEqual([]);
    expect(enc.match).toBeNull();
    expect(enc.decks).toBeNull();
    expect(enc.winners).toBeNull();
    // No plaintext leaders/winner anywhere on the stored row.
    expect(JSON.stringify(enc)).not.toContain('Vader');

    // A keyholder can decrypt the stored summary back to plaintext.
    const decoded = JSON.parse(await e2ee.decryptContent(key, JSON.parse(enc.encryptedSummary!)));
    expect(decoded.leaders).toEqual(['Vader', 'Luke']);
  });

  it('tags carry a ciphertext comment column; plaintext comment stays empty on encrypted tags', async () => {
    const db = getDb();
    const u = await seedUser();
    const { key } = await e2ee.generateTeamKey();
    await db
      .insert(replays)
      .values({ slug: 'r1', gameId: 'g1', ownerToken: 'kbx_c', players: [], payloadBlobUrl: 'http://blob/r1', encrypted: true })
      .returning();

    const env = await e2ee.encryptContent(key, 'nice tempo swing here');
    const [tag] = await db
      .insert(tags)
      .values({ id: 't1', replaySlug: 'r1', frameIndex: 3, authorToken: 'kbx_c', authorName: 'lead', comment: '', commentEncrypted: JSON.stringify(env) })
      .returning();
    expect(tag.comment).toBe('');
    expect(tag.commentEncrypted).toBeTruthy();
    expect(JSON.stringify(tag)).not.toContain('nice tempo swing');
    expect(await e2ee.decryptContent(key, JSON.parse(tag.commentEncrypted!))).toBe('nice tempo swing here');

    const reread = await db.select().from(tags).where(eq(tags.id, 't1'));
    expect(reread[0].commentEncrypted).toBe(tag.commentEncrypted);
  });
});
