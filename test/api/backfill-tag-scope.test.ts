import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db';
import { backfillTagScopes } from '@/lib/tagScope';
import { replays, replayTeamShares, tags, tagTeamScope, teamMembers, teams, users } from '@/lib/schema';
import { eq } from 'drizzle-orm';

// B71/B74 backfill recovery. Per replay: explicit shares win; else the single
// MULTI-MEMBER team common to all member-taggers (solo teams excluded); else
// personal (ambiguous).

let n = 0;
async function seedUser(name: string) {
  const id = randomUUID();
  await getDb().insert(users).values({ id, name, email: `${id}@e.com` });
  return id;
}
async function seedTeam(slug: string, owner: string, members: string[]) {
  const db = getDb();
  await db.insert(teams).values({ slug, name: slug, createdBy: owner });
  await db.insert(teamMembers).values(members.map((userId) => ({ teamSlug: slug, userId, role: userId === owner ? 'owner' : 'member' })));
}
async function seedReplay(slug: string, userId: string) {
  await getDb().insert(replays).values({
    slug, gameId: randomUUID(), userId, ownerToken: `kbx_${randomUUID()}`,
    players: [{ username: 'A' }, { username: 'B' }], payloadBlobUrl: `https://blob.test/${slug}.json`,
  });
}
async function seedTag(slug: string, userId: string | null) {
  const id = `tag-${n++}-${randomUUID().slice(0, 8)}`;
  await getDb().insert(tags).values({ id, replaySlug: slug, frameIndex: 0, userId, authorToken: 'kbx_a', authorName: 'A', comment: 'c' });
  return id;
}
async function scopeTeamsFor(tagId: string): Promise<string[]> {
  const rows = await getDb().select({ teamSlug: tagTeamScope.teamSlug }).from(tagTeamScope).where(eq(tagTeamScope.tagId, tagId));
  return rows.map((r) => r.teamSlug).sort();
}

describe('backfillTagScopes', () => {
  it('shares win — scopes to the shared team(s), even multiple', async () => {
    const u = await seedUser('U');
    await seedTeam('sh-a', u, [u]);
    await seedTeam('sh-b', u, [u]);
    await seedReplay('rep-shared', u);
    await getDb().insert(replayTeamShares).values([
      { replaySlug: 'rep-shared', teamSlug: 'sh-a', sharedBy: u },
      { replaySlug: 'rep-shared', teamSlug: 'sh-b', sharedBy: u },
    ]);
    const tag = await seedTag('rep-shared', u);

    await backfillTagScopes();
    expect(await scopeTeamsFor(tag)).toEqual(['sh-a', 'sh-b']);
  });

  it('recovers to the single multi-member team common to all taggers', async () => {
    const a = await seedUser('A');
    const b = await seedUser('B');
    await seedTeam('common', a, [a, b]); // 2 members
    await seedReplay('rep-common', a);
    const t1 = await seedTag('rep-common', a);
    const t2 = await seedTag('rep-common', b);

    await backfillTagScopes();
    expect(await scopeTeamsFor(t1)).toEqual(['common']);
    expect(await scopeTeamsFor(t2)).toEqual(['common']);
  });

  it('excludes a solo team — recovers to the real (multi-member) team', async () => {
    const a = await seedUser('A');
    const b = await seedUser('B');
    await seedTeam('real', a, [a, b]); // 2 members
    await seedTeam('mytest', a, [a]);  // solo — should be ignored
    await seedReplay('rep-solo-excl', a);
    const tag = await seedTag('rep-solo-excl', a); // tagged only by A (in both)

    await backfillTagScopes();
    expect(await scopeTeamsFor(tag)).toEqual(['real']);
  });

  it('leaves personal when the tagger is common to TWO multi-member teams', async () => {
    const a = await seedUser('A');
    const b = await seedUser('B');
    const c = await seedUser('C');
    await seedTeam('multi-a', a, [a, b]);
    await seedTeam('multi-b', a, [a, c]);
    await seedReplay('rep-ambig', a);
    const tag = await seedTag('rep-ambig', a); // only A; common = both → ambiguous

    await backfillTagScopes();
    expect(await scopeTeamsFor(tag)).toEqual([]);
  });

  it('leaves personal when no shares and the author is in no team', async () => {
    const u = await seedUser('Loner');
    await seedReplay('rep-loner', u);
    const tag = await seedTag('rep-loner', u);

    await backfillTagScopes();
    expect(await scopeTeamsFor(tag)).toEqual([]);
  });
});
