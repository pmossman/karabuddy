import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { requireTeamMember } from '@/lib/apiAuth';
import { getDb } from '@/lib/db';
import { teams } from '@/lib/schema';
import { postToChannel } from '@/lib/discord';

export const runtime = 'nodejs';

// B81: POST → send a test message to the team's configured Discord channel
// (owner-only). Confirms the bot can actually post before relying on it.
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireTeamMember(slug, { role: 'owner' });
  if (m instanceof NextResponse) return m;

  const [team] = await getDb().select({ name: teams.name, channelId: teams.discordChannelId }).from(teams).where(eq(teams.slug, slug)).limit(1);
  if (!team?.channelId) return NextResponse.json({ ok: false, error: 'no channel configured' }, { status: 400 });

  const res = await postToChannel(team.channelId, `✅ KaraBuddy is connected — team activity for **${team.name}** will post here.`);
  return NextResponse.json({ ok: res.ok, skipped: res.skipped });
}
