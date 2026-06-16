import { NextResponse } from 'next/server';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { replays, users, teamMembers, replayTeamShares, tournaments, tournamentEntrants } from '@/lib/schema';
import { getTeamMembership, surfacedReplaySlugs } from '@/lib/teamSurface';
import { serializeReplayRow } from '@/lib/replayRow';

export const runtime = 'nodejs';

const RECENT_REPLAYS = 6;
const REVIEW_PREVIEW = 5;
const OPEN_TOURNAMENTS = 5;

// GET /api/teams/[slug]/overview — the team dashboard "hub" bundle: one
// member-gated fetch that gives a real summary of everything going on in the
// team, one section per feature (members / tournaments / reviews / replays).
// Built by reusing the SAME helpers the individual tabs use so the summary
// can't drift from the drill-in pages.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  if (!(await getTeamMembership(slug, userId))) {
    return NextResponse.json({ ok: false, error: 'not a member' }, { status: 403 });
  }

  const db = getDb();

  // Members — the full roster (teams are small); the card shows avatars + names.
  const memberRows = await db
    .select({ userId: teamMembers.userId, role: teamMembers.role, name: users.name, image: users.image })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(eq(teamMembers.teamSlug, slug))
    .orderBy(teamMembers.joinedAt);

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

  // Open review requests for this team (same flag the Reviews tab reads), newest
  // first — count for the heading + a preview list of the actual replays.
  const flagged = await db
    .select({
      replaySlug: replayTeamShares.replaySlug,
      requestedAt: replayTeamShares.reviewRequestedAt,
      requestedBy: replayTeamShares.reviewRequestedBy,
    })
    .from(replayTeamShares)
    .where(and(eq(replayTeamShares.teamSlug, slug), isNotNull(replayTeamShares.reviewRequestedAt)))
    .orderBy(desc(replayTeamShares.reviewRequestedAt));

  let reviewReplays: any[] = [];
  if (flagged.length > 0) {
    const previewSlugs = flagged.slice(0, REVIEW_PREVIEW).map((f) => f.replaySlug);
    const requesterIds = Array.from(new Set(flagged.map((f) => f.requestedBy).filter(Boolean))) as string[];
    const requesterNames = new Map<string, string | null>();
    if (requesterIds.length > 0) {
      const rn = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, requesterIds));
      for (const r of rn) requesterNames.set(r.id, r.name ?? null);
    }
    const rows = await db
      .select({ replay: replays, ownerName: users.name })
      .from(replays)
      .leftJoin(users, eq(users.id, replays.userId))
      .where(inArray(replays.slug, previewSlugs));
    const bySlug = new Map(rows.map((r) => [r.replay.slug, r]));
    reviewReplays = previewSlugs
      .map((s) => {
        const row = bySlug.get(s);
        if (!row) return null;
        const f = flagged.find((x) => x.replaySlug === s)!;
        return {
          ...serializeReplayRow(row.replay, { ownerName: row.ownerName ?? null, viewerPlayerId: null }),
          requestedAt: f.requestedAt instanceof Date ? f.requestedAt.toISOString() : (f.requestedAt as any) ?? null,
          requestedByName: f.requestedBy ? requesterNames.get(f.requestedBy) ?? null : null,
        };
      })
      .filter(Boolean);
  }

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
      .select({ id: tournamentEntrants.tournamentId, n: tournamentEntrants.userId })
      .from(tournamentEntrants)
      .where(inArray(tournamentEntrants.tournamentId, openIds));
    for (const r of ec) entrantCounts.set(r.id, (entrantCounts.get(r.id) ?? 0) + 1);
  }

  return NextResponse.json({
    ok: true,
    counts: {
      tournaments: tRows.length,
      openReviews: flagged.length,
      surfacedReplays: surfaceSlugs.length,
      members: memberRows.length,
    },
    members: memberRows,
    openTournaments: openTournamentRows.map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      entrantCount: entrantCounts.get(t.id) ?? 0,
    })),
    reviewReplays,
    recentReplays,
  });
}
