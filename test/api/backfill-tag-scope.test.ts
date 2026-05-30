import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db';
import { backfillTagScopes } from '@/lib/tagScope';
import { replays, replayTeamShares, tags, tagTeamScope, teams, users } from '@/lib/schema';
import { eq } from 'drizzle-orm';

// B71 backfill: a tag on a replay shared with EXACTLY ONE team is scoped to
// that team; replays shared with 0 or 2+ teams keep their tags personal.

async function seedReplay(slug: string, userId: string) {
  const db = getDb();
  await db.insert(replays).values({
    slug,
    gameId: randomUUID(),
    userId,
    ownerToken: `kbx_${randomUUID()}`,
    players: [{ username: 'A' }, { username: 'B' }],
    payloadBlobUrl: `https://blob.test/${slug}.json`,
  });
}

async function seedTag(id: string, slug: string, userId: string) {
  const db = getDb();
  await db.insert(tags).values({
    id, replaySlug: slug, frameIndex: 0, userId,
    authorToken: 'kbx_author', authorName: 'A', comment: 'c',
  });
}

async function scopeTeamsFor(tagId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db.select({ teamSlug: tagTeamScope.teamSlug }).from(tagTeamScope).where(eq(tagTeamScope.tagId, tagId));
  return rows.map((r) => r.teamSlug).sort();
}

describe('backfillTagScopes', () => {
  it('scopes a tag to a replay shared with exactly one team', async () => {
    const db = getDb();
    const uid = randomUUID();
    await db.insert(users).values({ id: uid, name: 'U', email: `${uid}@e.com` });
    await db.insert(teams).values({ slug: 'solo', name: 'Solo', createdBy: uid });
    await seedReplay('rep-solo', uid);
    await db.insert(replayTeamShares).values({ replaySlug: 'rep-solo', teamSlug: 'solo', sharedBy: uid });
    await seedTag('tag-solo', 'rep-solo', uid);

    const res = await backfillTagScopes();
    expect(res.scoped).toBeGreaterThanOrEqual(1);
    expect(await scopeTeamsFor('tag-solo')).toEqual(['solo']);
  });

  it('leaves a tag personal when its replay is shared with two teams', async () => {
    const db = getDb();
    const uid = randomUUID();
    await db.insert(users).values({ id: uid, name: 'U2', email: `${uid}@e.com` });
    await db.insert(teams).values([
      { slug: 'tw-a', name: 'A', createdBy: uid },
      { slug: 'tw-b', name: 'B', createdBy: uid },
    ]);
    await seedReplay('rep-two', uid);
    await db.insert(replayTeamShares).values([
      { replaySlug: 'rep-two', teamSlug: 'tw-a', sharedBy: uid },
      { replaySlug: 'rep-two', teamSlug: 'tw-b', sharedBy: uid },
    ]);
    await seedTag('tag-two', 'rep-two', uid);

    await backfillTagScopes();
    expect(await scopeTeamsFor('tag-two')).toEqual([]);
  });

  it('leaves a tag personal when its replay is shared with no team', async () => {
    const db = getDb();
    const uid = randomUUID();
    await db.insert(users).values({ id: uid, name: 'U3', email: `${uid}@e.com` });
    await seedReplay('rep-none', uid);
    await seedTag('tag-none', 'rep-none', uid);

    await backfillTagScopes();
    expect(await scopeTeamsFor('tag-none')).toEqual([]);
  });
});
