// B144: post to a team's Discord channel when a replay is added to (or cleared
// from) the team's review queue. Best-effort, never throws — awaited from the
// review route with the same posture as notifyMentions / tournamentNotify.
// No-ops when the team has no review channel (override ?? main) or the bot token
// is unset. Channel posts are broadcasts — no per-user DM opt-in applies.
import { and, eq } from 'drizzle-orm';
import { getDb } from './db';
import { accounts, replays, replayTeamShares, teams, users } from './schema';
import { postToChannel, sendDM } from './discord';
import { teamChannelFor } from './teamDiscordChannel';
import { serializeReplayRow } from './replayRow';

function publicUrl(): string {
  return (process.env.KARABUDDY_PUBLIC_URL || 'https://karabuddy.app').replace(/\/$/, '');
}

// Pure, unit-tested.
export function formatReviewMessage(opts: {
  added: boolean;
  matchup: string;
  teamName: string;
  actorName: string;
  url: string;
}): string {
  return opts.added
    ? `🔍 **${opts.matchup}** added to **${opts.teamName}**'s review queue by **${opts.actorName}** — ${opts.url}`
    : `🗑️ **${opts.matchup}** review request cleared in **${opts.teamName}** by **${opts.actorName}** — ${opts.url}`;
}

// B149: a member left their "I reviewed this" mark — the request STAYS open
// (more eyes welcome), so this is distinct from clearing the request.
export function formatReviewedByMessage(opts: { matchup: string; teamName: string; actorName: string; url: string }): string {
  return `✅ **${opts.actorName}** reviewed **${opts.matchup}** in **${opts.teamName}** — ${opts.url}`;
}

// Build the "Leader vs Leader" matchup (the uploader's side first), preferring a
// user-set display name when present.
function matchupOf(replay: any): string {
  if (replay?.displayName) return String(replay.displayName);
  const row = serializeReplayRow(replay, { ownerName: null, viewerPlayerId: replay?.ownerPlayerId ?? null });
  return `${row.ownLeader?.name ?? '?'} vs ${row.oppLeader?.name ?? '?'}`;
}

export async function notifyTeamReview(opts: {
  replaySlug: string;
  teamSlug: string;
  requested: boolean;
  actingUserId: string | null;
}): Promise<void> {
  try {
    const channel = await teamChannelFor(opts.teamSlug, 'review');
    if (!channel) return;
    const db = getDb();
    const [replay] = await db.select().from(replays).where(eq(replays.slug, opts.replaySlug)).limit(1);
    if (!replay) return;
    const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.slug, opts.teamSlug)).limit(1);
    const actor = opts.actingUserId
      ? (await db.select({ name: users.name }).from(users).where(eq(users.id, opts.actingUserId)).limit(1))[0]?.name
      : null;
    await postToChannel(channel, formatReviewMessage({
      added: opts.requested,
      matchup: matchupOf(replay),
      teamName: team?.name ?? opts.teamSlug,
      actorName: actor ?? 'Someone',
      url: `${publicUrl()}/r/${opts.replaySlug}`,
    }));
  } catch (err) {
    console.error('[karabuddy] team review notify failed:', err);
  }
}

// B149: post when a member marks a replay reviewed (the request stays open).
export async function notifyReviewMark(opts: {
  replaySlug: string;
  teamSlug: string;
  actingUserId: string | null;
}): Promise<void> {
  try {
    const channel = await teamChannelFor(opts.teamSlug, 'review');
    if (!channel) return;
    const db = getDb();
    const [replay] = await db.select().from(replays).where(eq(replays.slug, opts.replaySlug)).limit(1);
    if (!replay) return;
    const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.slug, opts.teamSlug)).limit(1);
    const actor = opts.actingUserId
      ? (await db.select({ name: users.name }).from(users).where(eq(users.id, opts.actingUserId)).limit(1))[0]?.name
      : null;
    await postToChannel(channel, formatReviewedByMessage({
      matchup: matchupOf(replay),
      teamName: team?.name ?? opts.teamSlug,
      actorName: actor ?? 'Someone',
      url: `${publicUrl()}/r/${opts.replaySlug}`,
    }));
  } catch (err) {
    console.error('[karabuddy] review-mark notify failed:', err);
  }
}

// B194: DM the original REQUESTER when their requested review is finished.
// Distinct from the channel posts above: this is a targeted, opt-in DM to the
// one person who asked. Gated by users.reviewDmEnabled (default on) + a connected
// Discord account; no-ops on: no open request, requester == reviewer, pref off,
// or no Discord id. Best-effort, never throws. The channel post (notifyReviewMark)
// still fires separately as the team-visible baseline.
export function formatReviewFinishedDM(opts: { matchup: string; teamName: string; reviewerName: string; url: string }): string {
  return `🔎 **${opts.reviewerName}** finished reviewing your replay **${opts.matchup}** (${opts.teamName}) — ${opts.url}`;
}

export async function notifyReviewFinished(opts: {
  replaySlug: string;
  teamSlug: string;
  reviewerUserId: string;
}): Promise<void> {
  try {
    const db = getDb();
    const [share] = await db
      .select({ requestedBy: replayTeamShares.reviewRequestedBy })
      .from(replayTeamShares)
      .where(and(eq(replayTeamShares.replaySlug, opts.replaySlug), eq(replayTeamShares.teamSlug, opts.teamSlug)))
      .limit(1);
    const requesterId = share?.requestedBy;
    if (!requesterId || requesterId === opts.reviewerUserId) return; // no request, or reviewing your own request

    const [requester] = await db.select({ reviewDm: users.reviewDmEnabled }).from(users).where(eq(users.id, requesterId)).limit(1);
    if (!requester?.reviewDm) return; // opted out

    const [acct] = await db
      .select({ discordId: accounts.providerAccountId })
      .from(accounts)
      .where(and(eq(accounts.provider, 'discord'), eq(accounts.userId, requesterId)))
      .limit(1);
    if (!acct?.discordId) return; // no Discord to DM

    const [replay] = await db.select().from(replays).where(eq(replays.slug, opts.replaySlug)).limit(1);
    if (!replay) return;
    const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.slug, opts.teamSlug)).limit(1);
    const reviewer = (await db.select({ name: users.name }).from(users).where(eq(users.id, opts.reviewerUserId)).limit(1))[0]?.name;

    await sendDM(acct.discordId, formatReviewFinishedDM({
      matchup: matchupOf(replay),
      teamName: team?.name ?? opts.teamSlug,
      reviewerName: reviewer ?? 'A teammate',
      url: `${publicUrl()}/r/${opts.replaySlug}`,
    }));
  } catch (err) {
    console.error('[karabuddy] review-finished DM failed:', err);
  }
}
