import { NextResponse } from 'next/server';
import { eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { tournaments, tournamentMatches, tournamentRounds } from '@/lib/schema';
import { requireOrganizer } from '@/lib/tournamentAccess';
import { loadEntrantsAndMatches } from '@/lib/tournamentLifecycle';
import { notifyTournamentFinished } from '@/lib/tournamentNotify';

export const runtime = 'nodejs';

// POST /api/teams/[slug]/tournaments/[id]/finish — organizer; active→complete.
// The current round must be fully reported (it gets confirmed + completed),
// so final standings never contain half-reported rounds.
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const gate = await requireOrganizer(slug, id);
  if (gate instanceof NextResponse) return gate;
  const t = gate.access.tournament;
  if (t.status !== 'active') {
    return NextResponse.json({ ok: false, error: 'tournament is not active' }, { status: 409 });
  }

  const { matches, rounds } = await loadEntrantsAndMatches(id);
  const current = rounds.reduce((a, b) => (b.number > (a?.number ?? 0) ? b : a), rounds[0]);
  const db = getDb();
  if (current && current.status === 'active') {
    const currentMatches = matches.filter((m) => m.roundId === current.id);
    const pending = currentMatches.filter((m) => m.status === 'pending');
    if (pending.length > 0) {
      return NextResponse.json(
        { ok: false, error: `round ${current.number} has ${pending.length} unreported ${pending.length === 1 ? 'match' : 'matches'} — report or override them first` },
        { status: 409 }
      );
    }
    const reportedIds = currentMatches.filter((m) => m.status === 'reported').map((m) => m.id);
    if (reportedIds.length > 0) {
      await db.update(tournamentMatches).set({ status: 'confirmed' }).where(inArray(tournamentMatches.id, reportedIds));
    }
    await db.update(tournamentRounds).set({ status: 'complete' }).where(eq(tournamentRounds.id, current.id));
  }

  await db.update(tournaments).set({ status: 'complete', completedAt: new Date() }).where(eq(tournaments.id, id));

  // B125: post the podium to the team's Discord channel (best-effort).
  await notifyTournamentFinished(slug, id);
  return NextResponse.json({ ok: true });
}
