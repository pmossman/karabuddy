import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { teams } from '@/lib/schema';
import { getTeamMembership } from '@/lib/teamSurface';
import { listGuildTextChannels } from '@/lib/discord';

export const runtime = 'nodejs';

// B81: a team's Discord connection (owner-only).
//   GET   → { ok, guildId, channelId, channels: [{id,name}] }  (channels listed
//           via the bot when a guild is connected — powers the picker)
//   PATCH { channelId } | { disconnect: true }

async function ownerOf(slug: string): Promise<string | null> {
  const session = await auth();
  const id: string | null = session?.user?.id || null;
  if (!id) return null;
  const m = await getTeamMembership(slug, id);
  return m && m.role === 'owner' ? id : null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await ownerOf(slug))) return NextResponse.json({ ok: false, error: 'owner only' }, { status: 403 });
  const [team] = await getDb()
    .select({
      guildId: teams.discordGuildId,
      channelId: teams.discordChannelId,
      reviewChannelId: teams.discordReviewChannelId,
      tournamentChannelId: teams.discordTournamentChannelId,
    })
    .from(teams).where(eq(teams.slug, slug)).limit(1);
  if (!team) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  const channels = team.guildId ? await listGuildTextChannels(team.guildId) : [];
  return NextResponse.json({
    ok: true,
    guildId: team.guildId,
    channelId: team.channelId,
    reviewChannelId: team.reviewChannelId,
    tournamentChannelId: team.tournamentChannelId,
    channels,
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await ownerOf(slug))) return NextResponse.json({ ok: false, error: 'owner only' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const db = getDb();
  if (body.disconnect === true) {
    await db.update(teams).set({
      discordGuildId: null, discordChannelId: null, discordReviewChannelId: null, discordTournamentChannelId: null,
    }).where(eq(teams.slug, slug));
    return NextResponse.json({ ok: true, guildId: null, channelId: null });
  }
  // Build the partial update from whichever keys are present. For the per-feature
  // overrides (B144), an empty string / null CLEARS the override (falls back to
  // the main channel); a non-empty string sets it.
  const set: Partial<typeof teams.$inferInsert> = {};
  if (typeof body.channelId === 'string' && body.channelId) set.discordChannelId = body.channelId;
  if ('reviewChannelId' in body) set.discordReviewChannelId = body.reviewChannelId ? String(body.reviewChannelId) : null;
  if ('tournamentChannelId' in body) set.discordTournamentChannelId = body.tournamentChannelId ? String(body.tournamentChannelId) : null;
  if (Object.keys(set).length === 0) {
    return NextResponse.json({ ok: false, error: 'channelId, reviewChannelId, tournamentChannelId, or disconnect required' }, { status: 400 });
  }
  await db.update(teams).set(set).where(eq(teams.slug, slug));
  return NextResponse.json({
    ok: true,
    channelId: set.discordChannelId,
    reviewChannelId: set.discordReviewChannelId,
    tournamentChannelId: set.discordTournamentChannelId,
  });
}
