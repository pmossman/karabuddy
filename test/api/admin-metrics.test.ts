import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db';
import { users, replays, teams, teamMembers } from '@/lib/schema';
import { loadAdminMetrics } from '@/lib/adminMetrics';

// B157: the admin dashboard metrics loader (counters + zero-filled day series).

const DAY = 86_400_000;
async function seedUserAt(daysAgo: number) {
  const id = randomUUID();
  await getDb().insert(users).values({ id, name: `u-${id.slice(0, 4)}`, email: `${id}@e.com`, createdAt: new Date(Date.now() - daysAgo * DAY) });
  return id;
}
async function seedReplayAt(userId: string, daysAgo: number) {
  const slug = `r_${randomUUID().slice(0, 8)}`;
  await getDb().insert(replays).values({
    slug, gameId: randomUUID(), userId, ownerToken: `kbx_${randomUUID()}`,
    players: [{ id: 'p1', username: 'A' }], payloadBlobUrl: `https://b.test/${slug}.json`,
    createdAt: new Date(Date.now() - daysAgo * DAY),
  });
}

describe('loadAdminMetrics', () => {
  it('totals + 30d deltas, all-time weekly signups, 90d activity + active users, features', async () => {
    const now = new Date();
    const u1 = await seedUserAt(0);   // today
    const u2 = await seedUserAt(2);   // within 30d
    await seedUserAt(40);             // old (outside 30d window)
    await seedReplayAt(u1, 0);        // u1 active today
    await seedReplayAt(u1, 1);
    await seedReplayAt(u2, 50);       // old game

    const slug = randomUUID().slice(0, 6);
    await getDb().insert(teams).values({ slug, name: 'T', createdBy: u1, createdAt: now });
    await getDb().insert(teamMembers).values([{ teamSlug: slug, userId: u1, role: 'owner' }, { teamSlug: slug, userId: u2, role: 'member' }]);

    const m = await loadAdminMetrics(now);

    expect(m.counters.users).toBeGreaterThanOrEqual(3);
    expect(m.counters.games).toBeGreaterThanOrEqual(3);
    expect(m.counters).toHaveProperty('privateTeams');
    expect(m.deltas.users).toBeGreaterThanOrEqual(2); // u1 + u2 within 30d
    expect(m.deltas.games).toBeGreaterThanOrEqual(2);

    // All-time weekly signups; cumulative non-decreasing.
    expect(m.signupsWeekly.length).toBeGreaterThan(0);
    for (let i = 1; i < m.signupsCumulative.length; i++) {
      expect(m.signupsCumulative[i].n).toBeGreaterThanOrEqual(m.signupsCumulative[i - 1].n);
    }

    // 90-day daily activity, oldest→newest, today last, with an active column.
    expect(m.activity).toHaveLength(90);
    expect(m.activity[89].day).toBe(now.toISOString().slice(0, 10));
    expect(m.activity[89].active).toBeGreaterThanOrEqual(1); // u1 uploaded today
    expect(m.activeUsers.dau).toBeGreaterThanOrEqual(1);

    // Per-feature adoption present with weekly series.
    const keys = m.features.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(['comments', 'shares', 'sideboards', 'installs']));
    m.features.forEach((f) => expect(Array.isArray(f.weekly)).toBe(true));

    const t = m.topTeams.find((x) => x.slug === slug);
    expect(t?.members).toBe(2);
    expect(m.recentSignups.length).toBeGreaterThan(0);
  });
});
