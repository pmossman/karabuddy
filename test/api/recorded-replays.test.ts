import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db';
import { users, replays, replayParticipants, replayAltPayload } from '@/lib/schema';
import { recordedReplaySlugs } from '@/lib/recordedReplays';

// B156 (privacy): "My replays" / "Clips of my replays" must include only replays
// the user actually RECORDED — never an opponent's recording they were merely
// resolved into as a participant (which leaked the opponent's name + team shares).

async function seedUser() {
  const id = randomUUID();
  await getDb().insert(users).values({ id, name: `u-${id.slice(0, 4)}`, email: `${id}@e.com` });
  return id;
}
async function seedReplay(ownerId: string) {
  const slug = `r_${randomUUID().slice(0, 8)}`;
  await getDb().insert(replays).values({
    slug, gameId: randomUUID(), userId: ownerId, ownerToken: `kbx_${randomUUID()}`,
    players: [{ id: 'p1', username: 'A' }, { id: 'p2', username: 'B' }],
    payloadBlobUrl: `https://blob.test/${slug}.json`, ownerPlayerId: 'p1',
  });
  return slug;
}

describe('recordedReplaySlugs', () => {
  it('includes my own uploads but NOT an opponent-owned replay I only participated in', async () => {
    const me = await seedUser();
    const opponent = await seedUser();

    const mine = await seedReplay(me);
    const theirs = await seedReplay(opponent);
    // The leak vector: on upload, my handle was resolved to me → I'm a participant
    // on the OPPONENT's recording.
    await getDb().insert(replayParticipants).values({ replaySlug: theirs, userId: me });
    // (the owner is always a participant of their own replay, too)
    await getDb().insert(replayParticipants).values({ replaySlug: mine, userId: me });

    const { slugs } = await recordedReplaySlugs(me);
    expect(slugs).toContain(mine);
    expect(slugs).not.toContain(theirs); // <-- the privacy fix
  });

  it('includes a double-sided game where I recorded the ALT side', async () => {
    const me = await seedUser();
    const teammate = await seedUser();
    const canonical = await seedReplay(teammate); // teammate uploaded the canonical
    await getDb().insert(replayAltPayload).values({
      replaySlug: canonical, altUserId: me, altOwnerPlayerId: 'p2', payload: '{}',
    });

    const { slugs, altSideBySlug } = await recordedReplaySlugs(me);
    expect(slugs).toContain(canonical);
    expect(altSideBySlug.get(canonical)).toBe('p2');
  });
});
