import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db';
import { users, replays, teams, teamMembers, tags, replayTeamShares } from '@/lib/schema';
import { featureDetail, teamDetail, userDetail } from '@/lib/adminDetail';
import { searchUsers, searchTeams } from '@/lib/adminDirectory';

// B157-followup: admin drill-down (detail pages) + directories.

async function seedUser(name: string) {
  const id = randomUUID();
  await getDb().insert(users).values({ id, name, email: `${id}@e.com` });
  return id;
}
async function seedReplay(userId: string) {
  const slug = `r_${randomUUID().slice(0, 8)}`;
  await getDb().insert(replays).values({
    slug, gameId: randomUUID(), userId, ownerToken: `kbx_${randomUUID()}`,
    players: [{ id: 'p1', username: 'A' }], payloadBlobUrl: `https://b.test/${slug}.json`, displayName: 'Vader vs Luke',
  });
  return slug;
}

describe('admin directories + detail', () => {
  it('searchUsers ranks by activity and filters by name/email', async () => {
    const alice = await seedUser('Alice Skywalker');
    await seedUser('Bob Fett');
    await seedReplay(alice);
    await seedReplay(alice);

    const all = await searchUsers('', 'games');
    const a = all.find((u) => u.id === alice);
    expect(a).toBeTruthy();
    expect(a!.games).toBeGreaterThanOrEqual(2);
    expect(a!.activity).toBeGreaterThanOrEqual(2);

    const filtered = await searchUsers('skywalker');
    expect(filtered.some((u) => u.id === alice)).toBe(true);
    expect(filtered.some((u) => u.name === 'Bob Fett')).toBe(false);
  });

  it('searchTeams returns share + member counts and filters by name', async () => {
    const owner = await seedUser('Owner One');
    const slug = randomUUID().slice(0, 6);
    await getDb().insert(teams).values({ slug, name: 'Rogue Squadron', createdBy: owner });
    await getDb().insert(teamMembers).values({ teamSlug: slug, userId: owner, role: 'owner' });
    const rep = await seedReplay(owner);
    await getDb().insert(replayTeamShares).values({ replaySlug: rep, teamSlug: slug, sharedBy: owner });

    const rows = await searchTeams('rogue');
    const t = rows.find((x) => x.slug === slug);
    expect(t).toBeTruthy();
    expect(t!.members).toBe(1);
    expect(t!.shares).toBe(1);
  });

  it('userDetail bundles games, feature counts, teams, replays, comments', async () => {
    const uid = await seedUser('Detail User');
    const rep = await seedReplay(uid);
    await getDb().insert(tags).values({
      id: randomUUID(), replaySlug: rep, frameIndex: 3, userId: uid,
      authorToken: `kbx_${randomUUID()}`, authorName: 'Detail User', comment: 'nice play here',
    });

    const d = await userDetail(uid);
    expect(d).toBeTruthy();
    expect(d!.games).toBeGreaterThanOrEqual(1);
    expect(d!.recentReplays.some((r) => r.slug === rep)).toBe(true);
    expect(d!.recentComments.some((c) => c.text === 'nice play here')).toBe(true);
    expect(d!.featureCounts.find((f) => f.key === 'comments')?.n).toBeGreaterThanOrEqual(1);
    expect(await userDetail('nope-missing')).toBeNull();
  });

  it('teamDetail lists members, feature counts, recent shares', async () => {
    const owner = await seedUser('Team Owner');
    const slug = randomUUID().slice(0, 6);
    await getDb().insert(teams).values({ slug, name: 'Detail Team', createdBy: owner });
    await getDb().insert(teamMembers).values({ teamSlug: slug, userId: owner, role: 'owner' });
    const rep = await seedReplay(owner);
    await getDb().insert(replayTeamShares).values({ replaySlug: rep, teamSlug: slug, sharedBy: owner });

    const d = await teamDetail(slug);
    expect(d).toBeTruthy();
    expect(d!.members.some((m) => m.id === owner && m.role === 'owner')).toBe(true);
    expect(d!.featureCounts.find((f) => f.key === 'shares')?.n).toBeGreaterThanOrEqual(1);
    expect(d!.recentShares.some((s) => s.slug === rep)).toBe(true);
    expect(await teamDetail('nope-missing')).toBeNull();
  });

  it('private replays link to their team via key id (featureDetail + teamDetail + user chip)', async () => {
    const owner = await seedUser('Priv Owner');
    const slug = randomUUID().slice(0, 6);
    const kid = `key_${randomUUID().slice(0, 8)}`;
    await getDb().insert(teams).values({ slug, name: 'Private Squad', createdBy: owner, privateMode: true, teamKeyId: kid });
    await getDb().insert(teamMembers).values({ teamSlug: slug, userId: owner, role: 'owner' });
    const rslug = `r_${randomUUID().slice(0, 8)}`;
    await getDb().insert(replays).values({
      slug: rslug, gameId: randomUUID(), userId: owner, ownerToken: `kbx_${randomUUID()}`,
      players: [], payloadBlobUrl: 'https://b.test/e.json', encrypted: true, teamKeyId: kid, encryptedSummary: '{}',
    });
    // A plaintext replay by the same owner — must NOT count as a private replay.
    await seedReplay(owner);

    const td = await teamDetail(slug);
    expect(td!.private).toBe(true);
    expect(td!.privateReplays).toBe(1);

    const ud = await userDetail(owner);
    expect(ud!.teams.find((t) => t.slug === slug)?.private).toBe(true);
    // Exactly the ONE encrypted replay — the feature filter must be applied.
    expect(ud!.featureCounts.find((f) => f.key === 'privateReplays')?.n).toBe(1);
    expect(ud!.games).toBeGreaterThanOrEqual(2); // both replays are games

    const fd = await featureDetail('privateReplays');
    expect(fd!.topTeams.some((t) => t.slug === slug)).toBe(true);
    expect(fd!.topUsers.some((u) => u.id === owner)).toBe(true);
  });

  it('featureDetail returns weekly series + top users + recent', async () => {
    const uid = await seedUser('Commenter');
    const rep = await seedReplay(uid);
    await getDb().insert(tags).values({
      id: randomUUID(), replaySlug: rep, frameIndex: 1, userId: uid,
      authorToken: `kbx_${randomUUID()}`, authorName: 'Commenter', comment: 'hello',
    });

    const d = await featureDetail('comments');
    expect(d).toBeTruthy();
    expect(d!.label).toBe('Comments');
    expect(Array.isArray(d!.weekly)).toBe(true);
    expect(d!.topUsers.some((u) => u.id === uid)).toBe(true);
    expect(d!.recent.length).toBeGreaterThanOrEqual(1);
    expect(await featureDetail('bogus')).toBeNull();
  });
});
