import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { teams } from '@/lib/schema';
import { getTeamMembership } from '@/lib/teamSurface';

export const runtime = 'nodejs';

// B81: redirect target of the "Add to Discord" bot-invite flow. Discord sends
// the owner back here with ?guild_id=<server they added the bot to>&state=<teamSlug>.
// We bind that guild to the team (owner-only) and bounce back to the team's
// Settings tab so they can pick a channel. No token exchange needed — the bot
// token already lets us act in the guild once it's been added.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const guildId = url.searchParams.get('guild_id');
  const teamSlug = (url.searchParams.get('state') || '').trim();
  const back = (extra: string) =>
    NextResponse.redirect(new URL(`/teams/${encodeURIComponent(teamSlug)}?tab=settings&${extra}`, url.origin));

  if (!teamSlug) return NextResponse.redirect(new URL('/teams', url.origin));

  const session = await auth();
  const userId: string | null = session?.user?.id || null;
  if (!userId) return back('discord=signin');

  const me = await getTeamMembership(teamSlug, userId);
  if (!me || me.role !== 'owner') return back('discord=forbidden');

  if (!guildId) return back('discord=cancelled');

  // Bind the guild; clear any stale channel (the owner re-picks for the new guild).
  await getDb().update(teams).set({ discordGuildId: guildId, discordChannelId: null }).where(eq(teams.slug, teamSlug));
  return back('discord=connected');
}
