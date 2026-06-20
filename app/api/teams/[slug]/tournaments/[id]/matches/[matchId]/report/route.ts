import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { tournamentMatches, type TournamentGame } from '@/lib/schema';
import { getTournamentAccess } from '@/lib/tournamentAccess';
import { notifyMatchReported } from '@/lib/tournamentNotify';

export const runtime = 'nodejs';

// POST .../matches/[matchId]/report — enter a match result.
//   body: { games: [{winner: entrantId|null, replaySlug?}], source?: 'manual'|'replays' }
//
// Who: the ORGANIZER (always — their report lands directly as 'confirmed'),
// or a PAIRED LINKED PLAYER while the match isn't confirmed (lands as
// 'reported') — B127: including linked entrants who aren't team members
// (invite-link players). Guests can't self-report (no account) — their
// opponent or the organizer enters the score.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string; matchId: string }> }) {
  const { slug, id, matchId } = await params;
  const session = await auth();
  const userId: string | null = session?.user?.id || null;
  if (!userId) return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  const access = await getTournamentAccess(slug, id, userId);
  if (!access) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  if (!access.canView) return NextResponse.json({ ok: false, error: 'not a member or entrant' }, { status: 403 });
  const t = access.tournament;
  if (t.status !== 'active') {
    return NextResponse.json({ ok: false, error: 'tournament is not active' }, { status: 409 });
  }

  const db = getDb();
  const [match] = await db
    .select()
    .from(tournamentMatches)
    .where(and(eq(tournamentMatches.id, matchId), eq(tournamentMatches.tournamentId, id)))
    .limit(1);
  if (!match) return NextResponse.json({ ok: false, error: 'match not found' }, { status: 404 });
  if (match.entrant2Id === null) {
    return NextResponse.json({ ok: false, error: 'byes are automatic' }, { status: 400 });
  }

  const organizer = access.organizer;
  if (!organizer) {
    // A paired linked player may report until the organizer locks it.
    const mine = access.myEntrant;
    const isPaired = !!mine && (mine.id === match.entrant1Id || mine.id === match.entrant2Id);
    if (!isPaired) {
      return NextResponse.json({ ok: false, error: 'only the paired players or the organizer can report' }, { status: 403 });
    }
    if (match.status === 'confirmed') {
      return NextResponse.json({ ok: false, error: 'result is locked — ask the organizer to change it' }, { status: 409 });
    }
  }

  const body = await req.json().catch(() => ({}));
  const rawGames = Array.isArray(body.games) ? body.games : null;
  if (!rawGames || rawGames.length < 1 || rawGames.length > 5) {
    return NextResponse.json({ ok: false, error: 'games must be 1-5 entries' }, { status: 400 });
  }
  const valid = new Set([match.entrant1Id, match.entrant2Id]);
  const games: TournamentGame[] = [];
  for (const g of rawGames) {
    const winner = g?.winner ?? null;
    if (winner !== null && !valid.has(winner)) {
      return NextResponse.json({ ok: false, error: 'game winner must be one of the paired entrants' }, { status: 400 });
    }
    const game: TournamentGame = { winner };
    if (g?.replaySlug && typeof g.replaySlug === 'string') game.replaySlug = g.replaySlug.slice(0, 64);
    games.push(game);
  }
  const source = body.source === 'replays' ? 'replays' : 'manual';

  await db
    .update(tournamentMatches)
    .set({
      games,
      status: organizer ? 'confirmed' : 'reported',
      resultSource: source,
      reportedBy: userId,
      updatedAt: new Date(),
    })
    .where(eq(tournamentMatches.id, matchId));
  // B144: best-effort Discord post — never blocks the write.
  try { await notifyMatchReported(slug, id, matchId); } catch (e) { console.error('[karabuddy] notifyMatchReported failed:', e); }
  return NextResponse.json({ ok: true, status: organizer ? 'confirmed' : 'reported' });
}
