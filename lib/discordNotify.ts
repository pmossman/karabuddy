// B81/B56: fan a tag's structured @-mentions out to Discord DMs, honouring
// preferences. Pure data orchestration over the DB + lib/discord — fired
// fire-and-forget from the tag-write paths (must never block or fail a write).
//
// Rules:
//   • Direct @user mention → DM that user (unless they're the author, or their
//     global kill switch is on).
//   • @team mention → DM each team member (except author) whose per-team
//     dmOnTeamMention pref is ON (default ON) and whose global switch is off.
//   • A user hit both ways is DM'd once (direct wins).
//   • DM requires a linked Discord account (accounts.provider='discord') AND a
//     bot token (else lib/discord no-ops) AND the user shares the KaraBuddy
//     server with the bot (Discord platform rule).

import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from './db';
import { accounts, teamMembers, teamMemberPrefs, teams, users } from './schema';
import { sendDM, postToChannel } from './discord';

function publicUrl(): string {
  return (process.env.KARABUDDY_PUBLIC_URL || 'https://karabuddy.app').replace(/\/$/, '');
}

export interface MentionNotifyInput {
  mentions: { userIds?: string[]; teamSlugs?: string[] } | null | undefined;
  replaySlug: string;
  frameIndex: number;
  comment: string;
  authorUserId: string | null;
}

export interface NotifyResult {
  userId: string;
  // 'dm' = DM delivered; 'channel' = fell back to a team-channel @-ping;
  // 'none' = couldn't reach via Discord (no link / DM refused + no team
  // channel) — the in-app /mentions inbox still covers them.
  via: 'dm' | 'channel' | 'none';
}

// Best-effort, never throws — fired fire-and-forget from tag writes. Tries a DM
// first (works when the user shares a server with the bot, e.g. their team's);
// on failure falls back to an @-ping in the team's configured channel (grouped
// per channel). Never requires joining any specific server; the inbox is the
// universal backstop.
export async function notifyMentions(opts: MentionNotifyInput): Promise<NotifyResult[]> {
  const { mentions, replaySlug, frameIndex, comment, authorUserId } = opts;
  if (!mentions) return [];
  const directIds = (mentions.userIds || []).filter((id) => id && id !== authorUserId);
  const teamSlugs = (mentions.teamSlugs || []).filter(Boolean);
  if (directIds.length === 0 && teamSlugs.length === 0) return [];

  const db = getDb();

  // userId → the mentioned teams they belong to (drives the channel fallback;
  // empty for a purely-direct mention).
  const targetTeams = new Map<string, Set<string>>();
  const ensure = (u: string) => {
    let s = targetTeams.get(u);
    if (!s) { s = new Set(); targetTeams.set(u, s); }
    return s;
  };
  for (const id of directIds) ensure(id);

  const teamChannels = new Map<string, string>(); // teamSlug → discordChannelId
  if (teamSlugs.length > 0) {
    const members = await db
      .select({ userId: teamMembers.userId, teamSlug: teamMembers.teamSlug })
      .from(teamMembers)
      .where(inArray(teamMembers.teamSlug, teamSlugs));
    const prefRows = await db.select().from(teamMemberPrefs).where(inArray(teamMemberPrefs.teamSlug, teamSlugs));
    const key = (t: string, u: string) => `${t}:${u}`;
    // Strictly opt-in (B99): a member is DM'd for a team mention ONLY if they
    // explicitly enabled it (a pref row with dmOnTeamMention=true). No row /
    // false → no DM. (The global switch in notifies further gates this.)
    const teamMentionOn = new Set(prefRows.filter((p) => p.dmOnTeamMention).map((p) => key(p.teamSlug, p.userId)));
    const teamRows = await db.select({ slug: teams.slug, channel: teams.discordChannelId }).from(teams).where(inArray(teams.slug, teamSlugs));
    for (const t of teamRows) if (t.channel) teamChannels.set(t.slug, t.channel);
    for (const m of members) {
      if (m.userId === authorUserId) continue;
      if (!teamMentionOn.has(key(m.teamSlug, m.userId))) continue; // opt-in only
      ensure(m.userId).add(m.teamSlug);
    }
  }

  const userIds = [...targetTeams.keys()];
  if (userIds.length === 0) return [];

  // Global kill switch + Discord-account lookup (id lives in accounts).
  const userRows = await db.select({ id: users.id, off: users.notificationsDisabled }).from(users).where(inArray(users.id, userIds));
  const globallyOff = new Set(userRows.filter((u) => u.off).map((u) => u.id));
  const accountRows = await db
    .select({ userId: accounts.userId, discordId: accounts.providerAccountId })
    .from(accounts)
    .where(and(eq(accounts.provider, 'discord'), inArray(accounts.userId, userIds)));
  const discordByUser = new Map(accountRows.map((a) => [a.userId, a.discordId]));

  const link = `${publicUrl()}/r/${replaySlug}?f=${(Number(frameIndex) || 0) + 1}`;
  const preview = (comment || '').slice(0, 140);
  const dmContent = `You were mentioned on a KaraBuddy replay:\n> ${preview}\n${link}`;

  const results: NotifyResult[] = [];
  const channelQueue = new Map<string, Set<string>>(); // channelId → discordIds to @-ping
  for (const uid of userIds) {
    if (globallyOff.has(uid)) continue;
    const discordId = discordByUser.get(uid);
    if (!discordId) { results.push({ userId: uid, via: 'none' }); continue; }
    const dm = await sendDM(discordId, dmContent);
    if (dm.ok) { results.push({ userId: uid, via: 'dm' }); continue; }
    // DM refused/unavailable → fall back to a ping in a mentioned team's channel.
    let channelId: string | undefined;
    for (const slug of targetTeams.get(uid) || []) { channelId = teamChannels.get(slug); if (channelId) break; }
    if (channelId) {
      let set = channelQueue.get(channelId);
      if (!set) { set = new Set(); channelQueue.set(channelId, set); }
      set.add(discordId);
      results.push({ userId: uid, via: 'channel' });
    } else {
      results.push({ userId: uid, via: 'none' }); // inbox covers them
    }
  }

  // One grouped @-ping per channel.
  for (const [channelId, discordIds] of channelQueue) {
    const pings = [...discordIds].map((d) => `<@${d}>`).join(' ');
    await postToChannel(channelId, `${pings} — mentioned on a KaraBuddy replay:\n> ${preview}\n${link}`);
  }
  return results;
}
