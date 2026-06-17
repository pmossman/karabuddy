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
  it('counts totals, last-7d deltas, and zero-fills a 30-day series', async () => {
    const now = new Date();
    const u1 = await seedUserAt(0);   // today
    const u2 = await seedUserAt(2);   // within 7d
    await seedUserAt(40);             // old (outside 30d window)
    await seedReplayAt(u1, 0);
    await seedReplayAt(u1, 1);
    await seedReplayAt(u2, 50);       // old game

    const slug = randomUUID().slice(0, 6);
    await getDb().insert(teams).values({ slug, name: 'T', createdBy: u1, createdAt: now });
    await getDb().insert(teamMembers).values([{ teamSlug: slug, userId: u1, role: 'owner' }, { teamSlug: slug, userId: u2, role: 'member' }]);

    const m = await loadAdminMetrics(now);

    expect(m.counters.users).toBeGreaterThanOrEqual(3);
    expect(m.counters.games).toBeGreaterThanOrEqual(3);
    expect(m.counters.usersLast7).toBeGreaterThanOrEqual(2); // u1 + u2, not the 40-day-old one
    expect(m.counters.gamesLast7).toBeGreaterThanOrEqual(2); // the 2 recent games

    // Series are continuous 30-long, oldest→newest, today last.
    expect(m.signupsByDay).toHaveLength(30);
    expect(m.gamesByDay).toHaveLength(30);
    expect(m.signupsByDay[29].day).toBe(now.toISOString().slice(0, 10));
    expect(m.cumulativeUsers).toHaveLength(30);
    // Cumulative is non-decreasing.
    for (let i = 1; i < m.cumulativeUsers.length; i++) {
      expect(m.cumulativeUsers[i].n).toBeGreaterThanOrEqual(m.cumulativeUsers[i - 1].n);
    }

    // Top teams includes our seeded team with 2 members.
    const t = m.topTeams.find((x) => x.slug === slug);
    expect(t?.members).toBe(2);
    expect(m.recentUsers.length).toBeGreaterThan(0);
  });
});
