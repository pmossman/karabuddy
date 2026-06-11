import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { tournaments } from '@/lib/schema';
import { getTeamMembership } from '@/lib/teamSurface';
import { loadTournament, isOrganizer } from '@/lib/tournamentAccess';
import { createRound, loadEntrantsAndMatches } from '@/lib/tournamentLifecycle';
import { notifyRoundPaired } from '@/lib/tournamentNotify';

export const runtime = 'nodejs';

// POST /api/teams/[slug]/tournaments/[id]/start — organizer; setup→active +
// pair round 1. Registration closes (entrants POST checks status=setup).
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  const me = await getTeamMembership(slug, userId);
  if (!me) return NextResponse.json({ ok: false, error: 'not a member' }, { status: 403 });
  const t = await loadTournament(slug, id);
  if (!t) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  if (!isOrganizer(t, userId, me.role)) {
    return NextResponse.json({ ok: false, error: 'organizer only' }, { status: 403 });
  }
  if (t.status !== 'setup') {
    return NextResponse.json({ ok: false, error: 'already started' }, { status: 409 });
  }

  const { entrants } = await loadEntrantsAndMatches(id);
  const result = await createRound(id, 1, entrants, []);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });

  await getDb()
    .update(tournaments)
    .set({ status: 'active', startedAt: new Date() })
    .where(eq(tournaments.id, id));

  // B125: post the round-1 pairings to the team's Discord channel (best-effort
  // — same never-fail posture as notifyMentions on tag writes).
  await notifyRoundPaired(slug, id, result.roundId);
  return NextResponse.json({ ok: true, round: result });
}
