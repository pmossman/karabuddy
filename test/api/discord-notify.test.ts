import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, teamMemberPrefs, accounts } from '@/lib/schema';
import { eq } from 'drizzle-orm';

// B81/B56: notifyMentions — best-effort DM, fall back to a team-channel @-ping,
// inbox for the rest. Discord transport mocked.

vi.mock('@/lib/discord', () => ({
  sendDM: vi.fn(async () => ({ ok: true })),
  postToChannel: vi.fn(async () => ({ ok: true })),
}));
const { sendDM, postToChannel } = await import('@/lib/discord');
const { notifyMentions } = await import('@/lib/discordNotify');
const mockedSendDM = vi.mocked(sendDM);
const mockedPostChannel = vi.mocked(postToChannel);

async function seedUser({ globalOff = false, discord = true } = {}) {
  const id = randomUUID();
  const db = getDb();
  await db.insert(users).values({ id, name: id.slice(0, 4), email: `${id}@e.com`, notificationsDisabled: globalOff });
  if (discord) await db.insert(accounts).values({ userId: id, type: 'oidc' as any, provider: 'discord', providerAccountId: `dsc_${id.slice(0, 6)}` });
  return id;
}
async function seedTeam(members: string[], channel?: string) {
  const slug = randomUUID().slice(0, 6);
  await getDb().insert(teams).values({ slug, name: slug, createdBy: members[0], discordChannelId: channel ?? null });
  await getDb().insert(teamMembers).values(members.map((userId) => ({ teamSlug: slug, userId, role: 'member' })));
  return slug;
}

beforeEach(() => {
  mockedSendDM.mockReset().mockResolvedValue({ ok: true } as any);
  mockedPostChannel.mockReset().mockResolvedValue({ ok: true } as any);
});

describe('notifyMentions', () => {
  it('DMs a directly-mentioned user (frame deep-link), never the author', async () => {
    const author = await seedUser();
    const target = await seedUser();
    const res = await notifyMentions({ mentions: { userIds: [target, author] }, replaySlug: 'rep1', frameIndex: 5, comment: 'nice play', authorUserId: author });
    expect(res).toEqual([{ userId: target, via: 'dm' }]);
    const [discordId, content] = mockedSendDM.mock.calls[0];
    expect(discordId).toMatch(/^dsc_/);
    expect(content).toContain('/r/rep1?f=6');
    expect(content).toContain('nice play');
  });

  it('respects the global kill switch and a missing Discord link', async () => {
    const author = await seedUser();
    const off = await seedUser({ globalOff: true });
    const noDiscord = await seedUser({ discord: false });
    const ok = await seedUser();
    const res = await notifyMentions({ mentions: { userIds: [off, noDiscord, ok] }, replaySlug: 'r', frameIndex: 0, comment: 'x', authorUserId: author });
    expect(res.find((r) => r.userId === ok)?.via).toBe('dm');
    expect(res.find((r) => r.userId === noDiscord)?.via).toBe('none');
    expect(res.find((r) => r.userId === off)).toBeUndefined(); // filtered before send
    expect(mockedSendDM).toHaveBeenCalledTimes(1);
  });

  it('honours per-team opt-out and excludes the author on a team mention', async () => {
    const author = await seedUser();
    const on = await seedUser();
    const optedOut = await seedUser();
    const team = await seedTeam([author, on, optedOut]);
    await getDb().insert(teamMemberPrefs).values({ teamSlug: team, userId: optedOut, dmOnTeamMention: false });
    const res = await notifyMentions({ mentions: { teamSlugs: [team] }, replaySlug: 'r', frameIndex: 2, comment: 'team look', authorUserId: author });
    expect(res.map((r) => r.userId)).toEqual([on]);
  });

  it('falls back to a grouped team-channel @-ping when the DM is refused', async () => {
    mockedSendDM.mockResolvedValue({ ok: false, status: 403 } as any); // no shared server
    const author = await seedUser();
    const m1 = await seedUser();
    const m2 = await seedUser();
    const team = await seedTeam([author, m1, m2], 'chan-123');
    const res = await notifyMentions({ mentions: { teamSlugs: [team] }, replaySlug: 'r', frameIndex: 0, comment: 'look', authorUserId: author });
    expect(res.every((r) => r.via === 'channel')).toBe(true);
    // One grouped message to the team channel, pinging both members.
    expect(mockedPostChannel).toHaveBeenCalledTimes(1);
    const [channelId, content] = mockedPostChannel.mock.calls[0];
    expect(channelId).toBe('chan-123');
    expect((content.match(/<@dsc_/g) || []).length).toBe(2);
  });

  it('DM refused + no team channel configured → via none (inbox covers them)', async () => {
    mockedSendDM.mockResolvedValue({ ok: false } as any);
    const author = await seedUser();
    const m1 = await seedUser();
    const team = await seedTeam([author, m1]); // no channel
    const res = await notifyMentions({ mentions: { teamSlugs: [team] }, replaySlug: 'r', frameIndex: 0, comment: 'x', authorUserId: author });
    expect(res).toEqual([{ userId: m1, via: 'none' }]);
    expect(mockedPostChannel).not.toHaveBeenCalled();
  });

  it('no-ops on empty mentions', async () => {
    expect(await notifyMentions({ mentions: null, replaySlug: 'r', frameIndex: 0, comment: '', authorUserId: 'a' })).toEqual([]);
    expect(mockedSendDM).not.toHaveBeenCalled();
  });
});
