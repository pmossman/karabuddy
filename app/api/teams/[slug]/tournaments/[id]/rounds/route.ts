import { NextResponse } from 'next/server';
import { eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { tournamentMatches, tournamentRounds } from '@/lib/schema';
import { requireOrganizer } from '@/lib/tournamentAccess';
import { createRound, loadEntrantsAndMatches } from '@/lib/tournamentLifecycle';
import { notifyRoundPaired } from '@/lib/tournamentNotify';

export const runtime = 'nodejs';

// POST /api/teams/[slug]/tournaments/[id]/rounds — organizer; complete the
// current round (every match must be at least 'reported' — 409 with the
// outstanding tables otherwise; reported matches are implicitly confirmed)
// then pair the next one.
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const gate = await requireOrganizer(slug, id);
  if (gate instanceof NextResponse) return gate;
  const t = gate.access.tournament;
  if (t.status !== 'active') {
    return NextResponse.json({ ok: false, error: 'tournament is not active' }, { status: 409 });
  }

  const { entrants, matches, rounds } = await loadEntrantsAndMatches(id);
  const current = rounds.reduce((a, b) => (b.number > (a?.number ?? 0) ? b : a), rounds[0]);
  if (!current) return NextResponse.json({ ok: false, error: 'no rounds yet — start the tournament first' }, { status: 409 });

  const currentMatches = matches.filter((m) => m.roundId === current.id);
  const pending = currentMatches.filter((m) => m.status === 'pending');
  if (pending.length > 0) {
    return NextResponse.json(
      { ok: false, error: `round ${current.number} has ${pending.length} unreported ${pending.length === 1 ? 'match' : 'matches'} (table ${pending.map((m) => m.tableNumber).join(', ')})` },
      { status: 409 }
    );
  }

  const db = getDb();
  const reportedIds = currentMatches.filter((m) => m.status === 'reported').map((m) => m.id);
  if (reportedIds.length > 0) {
    await db.update(tournamentMatches).set({ status: 'confirmed' }).where(inArray(tournamentMatches.id, reportedIds));
  }
  await db.update(tournamentRounds).set({ status: 'complete' }).where(eq(tournamentRounds.id, current.id));

  const result = await createRound(id, current.number + 1, entrants, matches);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });

  // B125: post the new round's pairings to the team's Discord channel.
  await notifyRoundPaired(slug, id, result.roundId);
  return NextResponse.json({ ok: true, round: result });
}
