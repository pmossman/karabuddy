import { NextResponse } from 'next/server';
import { asc, eq, gte, inArray, or, and } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import {
  tournaments, tournamentEntrants, tournamentRounds, tournamentMatches,
  replays, replayParticipants, replayAltPayload, replayTeamShares,
  type TournamentEntrant, type TournamentRound, type TournamentMatch,
} from '@/lib/schema';
import { getTeamMembership } from '@/lib/teamSurface';
import { loadTournament, isOrganizer, canSeeDeck, serializeEntrant } from '@/lib/tournamentAccess';
import { computeStandings, suggestedRoundCount, type SwissMatch } from '@/lib/swiss';
import { suggestResult, type CandidateReplay, type ResultSuggestion } from '@/lib/tournamentResults';

export const runtime = 'nodejs';

const VISIBILITIES = ['open', 'hidden-until-start', 'private'] as const;

// GET /api/teams/[slug]/tournaments/[id] — the one detail payload the
// tournament page renders from: tournament, entrants (decks filtered per the
// visibility setting), rounds + matches, computed standings, viewer flags.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  const me = await getTeamMembership(slug, userId);
  if (!me) return NextResponse.json({ ok: false, error: 'not a member' }, { status: 403 });

  const t = await loadTournament(slug, id);
  if (!t) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  const organizer = isOrganizer(t, userId, me.role);

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

  // B124/P4: replay-derived result SUGGESTIONS for the active round's pending
  // matches where both entrants are account-linked. Computed on read, never
  // stored — confirming one goes through the normal report endpoint.
  const suggestions = t.status === 'active'
    ? await computeSuggestions(slug, entrants, rounds, matches)
    : {};

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
        createdAt: t.createdAt.toISOString(),
        startedAt: t.startedAt?.toISOString() ?? null,
        completedAt: t.completedAt?.toISOString() ?? null,
      },
      viewer: {
        userId,
        isOrganizer: organizer,
        entrantId: myEntrant?.id ?? null,
      },
      entrants: entrants.map((e) =>
        serializeEntrant(
          e,
          canSeeDeck({
            visibility: t.decklistVisibility,
            entrant: e,
            viewerUserId: userId,
            viewerIsOrganizer: organizer,
            roundCount: rounds.length,
          })
        )
      ),
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
      suggestions,
    },
  });
}

// Gather candidate replays for the active round's pending linked-vs-linked
// matches and run the pure derivation. One pass of queries for ALL such
// matches (team-scale fields keep this cheap).
async function computeSuggestions(
  teamSlug: string,
  entrants: TournamentEntrant[],
  rounds: TournamentRound[],
  matches: TournamentMatch[]
): Promise<Record<string, ResultSuggestion>> {
  const current = rounds.length > 0 ? rounds[rounds.length - 1] : null;
  if (!current || current.status !== 'active') return {};

  const entrantById = new Map(entrants.map((e) => [e.id, e]));
  const targets = matches.filter((m) => {
    if (m.roundId !== current.id || m.status !== 'pending' || m.entrant2Id === null) return false;
    return !!entrantById.get(m.entrant1Id)?.userId && !!entrantById.get(m.entrant2Id)?.userId;
  });
  if (targets.length === 0) return {};

  const userIds = Array.from(
    new Set(targets.flatMap((m) => [entrantById.get(m.entrant1Id)!.userId!, entrantById.get(m.entrant2Id!)!.userId!]))
  );

  const db = getDb();
  // Replays since the round was paired, uploaded by OR participated-in by any
  // paired user.
  const partRows = await db
    .select({ slug: replayParticipants.replaySlug, userId: replayParticipants.userId })
    .from(replayParticipants)
    .where(inArray(replayParticipants.userId, userIds));
  const partSlugs = Array.from(new Set(partRows.map((r) => r.slug)));

  const candidateRows = await db
    .select({
      slug: replays.slug,
      createdAt: replays.createdAt,
      userId: replays.userId,
      ownerPlayerId: replays.ownerPlayerId,
      winners: replays.winners,
      match: replays.match,
    })
    .from(replays)
    .where(
      and(
        gte(replays.createdAt, current.createdAt),
        partSlugs.length > 0
          ? or(inArray(replays.userId, userIds), inArray(replays.slug, partSlugs))
          : inArray(replays.userId, userIds)
      )
    );
  if (candidateRows.length === 0) return {};

  const slugs = candidateRows.map((r) => r.slug);
  const [shareRows, altRows] = await Promise.all([
    db
      .select({ slug: replayTeamShares.replaySlug })
      .from(replayTeamShares)
      .where(and(eq(replayTeamShares.teamSlug, teamSlug), inArray(replayTeamShares.replaySlug, slugs))),
    db
      .select({ slug: replayAltPayload.replaySlug, altUserId: replayAltPayload.altUserId, altOwnerPlayerId: replayAltPayload.altOwnerPlayerId })
      .from(replayAltPayload)
      .where(inArray(replayAltPayload.replaySlug, slugs)),
  ]);
  const shared = new Set(shareRows.map((r) => r.slug));
  const altBySlug = new Map(altRows.map((r) => [r.slug, r]));
  const participantsBySlug = new Map<string, string[]>();
  for (const r of partRows) {
    const arr = participantsBySlug.get(r.slug);
    if (arr) arr.push(r.userId);
    else participantsBySlug.set(r.slug, [r.userId]);
  }

  const candidates: CandidateReplay[] = candidateRows.map((r) => ({
    slug: r.slug,
    createdAt: r.createdAt,
    uploaderUserId: r.userId,
    participantUserIds: participantsBySlug.get(r.slug) ?? [],
    ownerPlayerId: r.ownerPlayerId,
    altOwnerPlayerId: altBySlug.get(r.slug)?.altOwnerPlayerId ?? null,
    winners: Array.isArray(r.winners) ? (r.winners as string[]) : null,
    lobbyId: (r.match as any)?.lobbyId && typeof (r.match as any).lobbyId === 'string' ? (r.match as any).lobbyId : null,
    sharedToTeam: shared.has(r.slug),
  }));

  const out: Record<string, ResultSuggestion> = {};
  for (const m of targets) {
    const e1 = entrantById.get(m.entrant1Id)!;
    const e2 = entrantById.get(m.entrant2Id!)!;
    const suggestion = suggestResult({
      entrant1: { id: e1.id, userId: e1.userId! },
      entrant2: { id: e2.id, userId: e2.userId! },
      roundStartedAt: current.createdAt,
      replays: candidates,
    });
    if (suggestion) out[m.id] = suggestion;
  }
  return out;
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
