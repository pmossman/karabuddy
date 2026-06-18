import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db';
import { users, replays, replayParticipants } from '@/lib/schema';
import { recordedReplaySlugs } from '@/lib/recordedReplays';

// B156/B166: "My replays" = the rows I OWN. Never an opponent's recording I was
// merely resolved into as a participant (B156), and — post-backfill — a
// co-recorded game surfaces via MY OWN sibling row, never the teammate's
// canonical (no duplicate).

async function seedUser() {
  const id = randomUUID();
  await getDb().insert(users).values({ id, name: `u-${id.slice(0, 4)}`, email: `${id}@e.com` });
  return id;
}
async function seedReplay(ownerId: string, gameId = randomUUID()) {
  const slug = `r_${randomUUID().slice(0, 8)}`;
  await getDb().insert(replays).values({
    slug, gameId, userId: ownerId, ownerToken: `kbx_${randomUUID()}`,
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
    await getDb().insert(replayParticipants).values({ replaySlug: theirs, userId: me });
    await getDb().insert(replayParticipants).values({ replaySlug: mine, userId: me });

    const { slugs } = await recordedReplaySlugs(me);
    expect(slugs).toContain(mine);
    expect(slugs).not.toContain(theirs);
  });

  it('a co-recorded game surfaces via MY OWN sibling row, not the teammate canonical', async () => {
    const me = await seedUser();
    const teammate = await seedUser();
    const gameId = randomUUID();
    const canonical = await seedReplay(teammate, gameId); // teammate's row
    const mineSibling = await seedReplay(me, gameId);      // my own sibling row

    const { slugs } = await recordedReplaySlugs(me);
    expect(slugs).toContain(mineSibling);
    expect(slugs).not.toContain(canonical);
  });
});
