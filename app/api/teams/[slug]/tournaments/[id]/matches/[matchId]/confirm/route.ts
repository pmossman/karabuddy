import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { tournamentMatches } from '@/lib/schema';
import { getTeamMembership } from '@/lib/teamSurface';
import { loadTournament, isOrganizer } from '@/lib/tournamentAccess';

export const runtime = 'nodejs';

// POST .../matches/[matchId]/confirm — organizer locks a player-reported
// result (players can no longer change it; the organizer can re-report).
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string; id: string; matchId: string }> }) {
  const { slug, id, matchId } = await params;
  const session = await auth();
  const userId: string | null = session?.user?.id || null;
  if (!userId) return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  const me = await getTeamMembership(slug, userId);
  if (!me) return NextResponse.json({ ok: false, error: 'not a member' }, { status: 403 });
  const t = await loadTournament(slug, id);
  if (!t) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  if (!isOrganizer(t, userId, me.role)) {
    return NextResponse.json({ ok: false, error: 'organizer only' }, { status: 403 });
  }

  const db = getDb();
  const [match] = await db
    .select()
    .from(tournamentMatches)
    .where(and(eq(tournamentMatches.id, matchId), eq(tournamentMatches.tournamentId, id)))
    .limit(1);
  if (!match) return NextResponse.json({ ok: false, error: 'match not found' }, { status: 404 });
  if (match.status === 'pending') {
    return NextResponse.json({ ok: false, error: 'nothing reported yet' }, { status: 409 });
  }

  await db.update(tournamentMatches).set({ status: 'confirmed', updatedAt: new Date() }).where(eq(tournamentMatches.id, matchId));
  return NextResponse.json({ ok: true });
}
