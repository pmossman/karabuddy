// B144: post to a team's Discord channel when a replay is added to (or cleared
// from) the team's review queue. Best-effort, never throws — awaited from the
// review route with the same posture as notifyMentions / tournamentNotify.
// No-ops when the team has no review channel (override ?? main) or the bot token
// is unset. Channel posts are broadcasts — no per-user DM opt-in applies.
import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { replays, teams, users } from './schema';
import { postToChannel } from './discord';
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
