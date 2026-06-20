import { NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import {
  tournaments, tournamentEntrants, tournamentRounds, tournamentMatches,
} from '@/lib/schema';
import { getTeamMembership } from '@/lib/teamSurface';
import { loadTournament, isOrganizer, canSeeDeck, serializeEntrant, getTournamentAccess } from '@/lib/tournamentAccess';
import { validateDecks } from '@/lib/deckLegalityServer';
import { computeStandings, suggestedRoundCount, type SwissMatch } from '@/lib/swiss';

export const runtime = 'nodejs';

const VISIBILITIES = ['open', 'hidden-until-start', 'private'] as const;

// GET /api/teams/[slug]/tournaments/[id] — the one detail payload the
// tournament page renders from: tournament, entrants (decks filtered per the
// visibility setting), rounds + matches, computed standings, viewer flags.
// B127: viewable by team members OR linked entrants (tournament-scoped access
// for players who came in via the public invite link).
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });

  const access = await getTournamentAccess(slug, id, userId);
  if (!access) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  if (!access.canView) return NextResponse.json({ ok: false, error: 'not a member or entrant' }, { status: 403 });
  const t = access.tournament;
  const organizer = access.organizer;

  const db = getDb();
  const [entrants, rounds, matches] = await Promise.all([
    db.select().from(tournamentEntrants).where(eq(tournamentEntrants.tournamentId, id)).orderBy(asc(tournamentEntrants.createdAt)),
    db.select().from(tournamentRounds).where(eq(tournamentRounds.tournamentId, id)).orderBy(asc(tournamentRounds.number)),
    db.select().from(tournamentMatches).where(eq(tournamentMatches.tournamentId, id)).orderBy(asc(tournamentMatches.tableNumber)),
  ]);

  const swissMatches: SwissMatch[] = matches.map((m) => ({
    entrant1Id: m.entrant1Id,
    entrant2Id: m.entrant2Id,
    games: (m.games as { winner: string | null }[]) ?? [],
  }));
  const standings = computeStandings(
    entrants.map((e) => ({ id: e.id, dropped: e.dropped })),
    swissMatches,
    t.id // stable tiebreak seed for the whole tournament
  );

  const myEntrant = entrants.find((e) => e.userId === userId) ?? null;

  // B152: serialize entrants (decks filtered per visibility), then validate the
  // VISIBLE decks in one batch and attach a legality flag (sideboard >10, etc.).
  const serializedEntrants = entrants.map((e) =>
    serializeEntrant(
      e,
      canSeeDeck({ visibility: t.decklistVisibility, entrant: e, viewerUserId: userId, viewerIsOrganizer: organizer, roundCount: rounds.length }),
      { includeClaimToken: organizer },
    ),
  );
  const legalities = await validateDecks(serializedEntrants.map((s) => (s.deckVisible ? s.deck : null)));
  const entrantsOut = serializedEntrants.map((s, i) => ({ ...s, legality: s.deckVisible && s.deck ? legalities[i] : null }));

  return NextResponse.json({
    ok: true,
    data: {
      tournament: {
        id: t.id,
        teamSlug: t.teamSlug,
        name: t.name,
        status: t.status,
        pairingFormat: t.pairingFormat,
        matchFormat: t.matchFormat,
        decklistVisibility: t.decklistVisibility,
        plannedRounds: t.plannedRounds,
        suggestedRounds: suggestedRoundCount(entrants.filter((e) => !e.dropped).length),
        // B126: the public invite capability — organizer-only (it's a secret).
        inviteCode: organizer ? t.inviteCode : null,
        createdAt: t.createdAt.toISOString(),
        startedAt: t.startedAt?.toISOString() ?? null,
        completedAt: t.completedAt?.toISOString() ?? null,
      },
      viewer: {
        userId,
        isOrganizer: organizer,
        isMember: access.isMember,
        entrantId: myEntrant?.id ?? null,
      },
      entrants: entrantsOut,
      rounds: rounds.map((r) => ({
        id: r.id,
        number: r.number,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        matches: matches
          .filter((m) => m.roundId === r.id)
          .map((m) => ({
            id: m.id,
            tableNumber: m.tableNumber,
            entrant1Id: m.entrant1Id,
            entrant2Id: m.entrant2Id, // null = bye
            games: m.games,
            status: m.status,
            resultSource: m.resultSource,
          })),
      })),
      standings,
    },
  });
}

// PATCH — organizer edits settings: { name?, decklistVisibility?, plannedRounds? }
export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
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

  const body = await req.json().catch(() => ({}));
  const update: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = String(body.name || '').trim().slice(0, 120);
    if (!name) return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 });
    update.name = name;
  }
  if (body.decklistVisibility !== undefined) {
    if (!VISIBILITIES.includes(body.decklistVisibility)) {
      return NextResponse.json({ ok: false, error: 'invalid decklistVisibility' }, { status: 400 });
    }
    update.decklistVisibility = body.decklistVisibility;
  }
  if (body.plannedRounds !== undefined) {
    if (body.plannedRounds === null) {
      update.plannedRounds = null;
    } else {
      const n = Number(body.plannedRounds);
      if (!Number.isInteger(n) || n < 1 || n > 20) {
        return NextResponse.json({ ok: false, error: 'invalid plannedRounds' }, { status: 400 });
      }
      update.plannedRounds = n;
    }
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: false, error: 'nothing to update' }, { status: 400 });
  }
  await getDb().update(tournaments).set(update).where(eq(tournaments.id, id));
  return NextResponse.json({ ok: true });
}

// DELETE — organizer, SETUP ONLY. A started/finished tournament is a team
// record; it can be abandoned (finish early) but never erased.
export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
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
    return NextResponse.json({ ok: false, error: 'only a tournament in setup can be deleted' }, { status: 409 });
  }
  await getDb().delete(tournaments).where(eq(tournaments.id, id)); // entrants cascade
  return NextResponse.json({ ok: true });
}
