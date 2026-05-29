import { NextResponse } from 'next/server';
import { desc, eq, inArray } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { replays, users } from '@/lib/schema';
import { getTeamMembership, surfacedReplaySlugs } from '@/lib/teamSurface';
import { orderPlayersOwnerFirst } from '@/lib/players';

export const runtime = 'nodejs';

// GET /api/teams/[slug]/replays — list replays surfaced to this team.
// Member-only. Surfacing rule lives in lib/teamSurface; this route is
// the thin shell that joins user names + sorts.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  }

  const me = await getTeamMembership(slug, userId);
  if (!me) {
    return NextResponse.json({ ok: false, error: 'not a member' }, { status: 403 });
  }

  const surfaceSlugs = await surfacedReplaySlugs([slug]);
  if (surfaceSlugs.length === 0) {
    return NextResponse.json({ ok: true, data: [] });
  }

  const db = getDb();
  const rows = await db
    .select({ replay: replays, ownerName: users.name })
    .from(replays)
    .leftJoin(users, eq(users.id, replays.userId))
    .where(inArray(replays.slug, surfaceSlugs))
    .orderBy(desc(replays.createdAt))
    .limit(200);

  // Flatten {replay, ownerName} so TeamReplays sees the same shape it
  // always has, with ownerName tacked on for the Member column. Players
  // are reordered owner-first (B59-followup).
  const flat = rows.map(({ replay, ownerName }) => ({
    ...replay,
    players: orderPlayersOwnerFirst(replay.players, replay.ownerPlayerId),
    ownerName,
  }));
  return NextResponse.json({ ok: true, data: flat });
}
