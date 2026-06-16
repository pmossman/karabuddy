import { NextResponse } from 'next/server';
import { and, desc, eq, inArray, isNotNull, count } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { replays, users, teamMembers, replayTeamShares, tournaments, tournamentEntrants } from '@/lib/schema';
import { getTeamMembership, surfacedReplaySlugs } from '@/lib/teamSurface';
import { serializeReplayRow } from '@/lib/replayRow';

export const runtime = 'nodejs';

const RECENT_REPLAYS = 4;
const OPEN_TOURNAMENTS = 3;

// GET /api/teams/[slug]/overview — the team dashboard "hub" bundle: one
// member-gated fetch that summarizes everything going on in the team, built by
// reusing the SAME helpers the individual tabs use (so the summary can't drift
// from the drill-in pages). Returns counts + small preview lists; the dashboard
// cards each deep-link to their full tab.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  if (!(await getTeamMembership(slug, userId))) {
    return NextResponse.json({ ok: false, error: 'not a member' }, { status: 403 });
  }

  const db = getDb();

  // Surfaced replays for this team (same rule as the Replays tab).
  const surfaceSlugs = await surfacedReplaySlugs([slug]);

  // Recent surfaced replays — newest first, enriched for ReplayCard.
  let recentReplays: ReturnType<typeof serializeReplayRow>[] = [];
  if (surfaceSlugs.length > 0) {
    const rows = await db
      .select({ replay: replays, ownerName: users.name })
      .from(replays)
      .leftJoin(users, eq(users.id, replays.userId))
      .where(inArray(replays.slug, surfaceSlugs))
      .orderBy(desc(replays.createdAt))
      .limit(RECENT_REPLAYS);
    recentReplays = rows.map((r) =>
      serializeReplayRow(r.replay, { ownerName: r.ownerName ?? null, viewerPlayerId: null }),
    );
  }

  // Open review requests for this team (same flag the Reviews tab reads).
  const [{ n: openReviews }] = await db
    .select({ n: count() })
    .from(replayTeamShares)
    .where(and(eq(replayTeamShares.teamSlug, slug), isNotNull(replayTeamShares.reviewRequestedAt)));

  // Members count.
  const [{ n: memberCount }] = await db
    .select({ n: count() })
    .from(teamMembers)
    .where(eq(teamMembers.teamSlug, slug));

  // Tournaments — all for the count, the active/recent few (not completed) for
  // the card, with entrant counts.
  const tRows = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.teamSlug, slug))
    .orderBy(desc(tournaments.createdAt));
  const openTournamentRows = tRows.filter((t) => t.status !== 'completed').slice(0, OPEN_TOURNAMENTS);
  const entrantCounts = new Map<string, number>();
  const openIds = openTournamentRows.map((t) => t.id);
  if (openIds.length > 0) {
    const ec = await db
      .select({ id: tournamentEntrants.tournamentId, n: count() })
      .from(tournamentEntrants)
      .where(inArray(tournamentEntrants.tournamentId, openIds))
      .groupBy(tournamentEntrants.tournamentId);
    for (const r of ec) entrantCounts.set(r.id, Number(r.n));
  }

  return NextResponse.json({
    ok: true,
    counts: {
      tournaments: tRows.length,
      openReviews: Number(openReviews),
      surfacedReplays: surfaceSlugs.length,
      members: Number(memberCount),
    },
    openTournaments: openTournamentRows.map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      entrantCount: entrantCounts.get(t.id) ?? 0,
    })),
    recentReplays,
  });
}
