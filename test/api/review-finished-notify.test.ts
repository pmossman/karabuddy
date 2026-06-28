import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db';
import { users, teams, replays, replayTeamShares, accounts } from '@/lib/schema';
import { markReviewed } from '@/lib/reviews';

// B194: the targeted "your requested review was finished" DM. We mock the Discord
// REST layer and assert the GATING (who gets DM'd) — pref off, no Discord, self-
// review, and no open request all suppress it.
vi.mock('@/lib/discord', () => ({ sendDM: vi.fn(async () => ({ ok: true })), postToChannel: vi.fn(async () => ({ ok: true })) }));
const { sendDM } = await import('@/lib/discord');
const { notifyReviewFinished } = await import('@/lib/reviewNotify');

async function seedUser(opts: { reviewDm?: boolean; discordId?: string | null } = {}) {
  const id = randomUUID();
  await getDb().insert(users).values({ id, name: 'U', email: `${id}@e.com`, reviewDmEnabled: opts.reviewDm ?? true });
  if (opts.discordId) await getDb().insert(accounts).values({ userId: id, type: 'oauth', provider: 'discord', providerAccountId: opts.discordId });
  return id;
}
async function seedReplayShare(opts: { ownerId: string; teamSlug: string; requestedBy: string | null }) {
  const slug = randomUUID().slice(0, 8);
  await getDb().insert(replays).values({ slug, gameId: randomUUID(), userId: opts.ownerId, ownerToken: `kbx_${randomUUID()}`, players: [{ username: 'A' }, { username: 'B' }], payloadBlobUrl: 'memory://x' });
  await getDb().insert(replayTeamShares).values({ replaySlug: slug, teamSlug: opts.teamSlug, sharedBy: opts.ownerId, reviewRequestedAt: opts.requestedBy ? new Date() : null, reviewRequestedBy: opts.requestedBy });
  return slug;
}

let team: string;
beforeEach(async () => {
  vi.mocked(sendDM).mockClear();
  const owner = await seedUser();
  team = randomUUID().slice(0, 6);
  await getDb().insert(teams).values({ slug: team, name: 'Team', createdBy: owner });
});

describe('notifyReviewFinished — gating', () => {
  it('DMs the requester when pref on + Discord connected + reviewer ≠ requester', async () => {
    const requester = await seedUser({ reviewDm: true, discordId: 'disc_123' });
    const reviewer = await seedUser();
    const slug = await seedReplayShare({ ownerId: requester, teamSlug: team, requestedBy: requester });
    await notifyReviewFinished({ replaySlug: slug, teamSlug: team, reviewerUserId: reviewer });
    expect(sendDM).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendDM).mock.calls[0][0]).toBe('disc_123');
  });

  it('does NOT DM when the requester opted out (reviewDmEnabled=false)', async () => {
    const requester = await seedUser({ reviewDm: false, discordId: 'disc_123' });
    const reviewer = await seedUser();
    const slug = await seedReplayShare({ ownerId: requester, teamSlug: team, requestedBy: requester });
    await notifyReviewFinished({ replaySlug: slug, teamSlug: team, reviewerUserId: reviewer });
    expect(sendDM).not.toHaveBeenCalled();
  });

  it('does NOT DM when the requester has no Discord account', async () => {
    const requester = await seedUser({ reviewDm: true, discordId: null });
    const reviewer = await seedUser();
    const slug = await seedReplayShare({ ownerId: requester, teamSlug: team, requestedBy: requester });
    await notifyReviewFinished({ replaySlug: slug, teamSlug: team, reviewerUserId: reviewer });
    expect(sendDM).not.toHaveBeenCalled();
  });

  it('does NOT DM when the reviewer IS the requester (reviewing your own request)', async () => {
    const requester = await seedUser({ reviewDm: true, discordId: 'disc_123' });
    const slug = await seedReplayShare({ ownerId: requester, teamSlug: team, requestedBy: requester });
    await notifyReviewFinished({ replaySlug: slug, teamSlug: team, reviewerUserId: requester });
    expect(sendDM).not.toHaveBeenCalled();
  });

  it('does NOT DM when there is no open request', async () => {
    const owner = await seedUser({ discordId: 'disc_123' });
    const reviewer = await seedUser();
    const slug = await seedReplayShare({ ownerId: owner, teamSlug: team, requestedBy: null });
    await notifyReviewFinished({ replaySlug: slug, teamSlug: team, reviewerUserId: reviewer });
    expect(sendDM).not.toHaveBeenCalled();
  });

  it('B195: updated=true DMs the requester an "updated their review" message', async () => {
    const requester = await seedUser({ reviewDm: true, discordId: 'disc_123' });
    const reviewer = await seedUser();
    const slug = await seedReplayShare({ ownerId: requester, teamSlug: team, requestedBy: requester });
    await notifyReviewFinished({ replaySlug: slug, teamSlug: team, reviewerUserId: reviewer, updated: true });
    expect(sendDM).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendDM).mock.calls[0][1]).toContain('updated their review');
  });
});

describe('markReviewed idempotency', () => {
  it('returns true on the first mark, false on a repeat', async () => {
    const reviewer = await seedUser();
    const owner = await seedUser();
    const slug = await seedReplayShare({ ownerId: owner, teamSlug: team, requestedBy: owner });
    expect(await markReviewed(slug, team, reviewer)).toBe(true);
    expect(await markReviewed(slug, team, reviewer)).toBe(false);
  });
});
