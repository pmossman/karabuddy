import { NextResponse } from 'next/server';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { replays, users, teamMembers, replayTeamShares, tournaments, tournamentEntrants, tournamentRounds, tags, tagTeamScope } from '@/lib/schema';
import { getTeamMembership, surfacedReplaySlugs } from '@/lib/teamSurface';
import { serializeReplayRow } from '@/lib/replayRow';
import { reviewersForTeam } from '@/lib/reviews';
import { orderPlayersOwnerFirst } from '@/lib/players';

export const runtime = 'nodejs';

const RECENT_REPLAYS = 6;
const REVIEW_PREVIEW = 8;
const DISCUSSION_PREVIEW = 5;
const OPEN_TOURNAMENTS = 4;

// GET /api/teams/[slug]/overview — the team dashboard bundle: one member-gated
// fetch summarizing recent activity across every feature (members, tournaments,
// reviews, discussion, replays), built by reusing the same queries/helpers the
// individual tabs use so the dashboard can't drift from the drill-in pages.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  if (!(await getTeamMembership(slug, userId))) {
    return NextResponse.json({ ok: false, error: 'not a member' }, { status: 403 });
  }

  const db = getDb();

  // Members — full roster (teams are small).
  const memberRows = await db
    .select({ userId: teamMembers.userId, role: teamMembers.role, name: users.name, image: users.image })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(eq(teamMembers.teamSlug, slug))
    .orderBy(teamMembers.joinedAt);

  // Surfaced replays for this team (same rule as the Replays tab).
  const surfaceSlugs = await surfacedReplaySlugs([slug]);

  // Recent surfaced replays — newest first, enriched for the compact list.
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

  // Open review requests for this team, newest first. "awaiting you" = those the
  // viewer hasn't yet marked reviewed (durable reviewer marks, same as the tab).
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
  let awaitingYou = 0;
  if (flagged.length > 0) {
    const flaggedSlugs = flagged.map((f) => f.replaySlug);
    const reviewerMarks = await reviewersForTeam(flaggedSlugs, slug);
    const reviewedByYou = (s: string) => (reviewerMarks.get(s) ?? []).some((m) => m.userId === userId);
    awaitingYou = flagged.filter((f) => !reviewedByYou(f.replaySlug)).length;

    const previewSlugs = flaggedSlugs.slice(0, REVIEW_PREVIEW);
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
        const marks = reviewerMarks.get(s) ?? [];
        return {
          ...serializeReplayRow(row.replay, { ownerName: row.ownerName ?? null, viewerPlayerId: null }),
          requestedAt: f.requestedAt instanceof Date ? f.requestedAt.toISOString() : (f.requestedAt as any) ?? null,
          requestedByName: f.requestedBy ? requesterNames.get(f.requestedBy) ?? null : null,
          reviewedByYou: reviewedByYou(s),
          reviewerCount: marks.length,
          reviewerNames: marks.map((m) => m.name).filter(Boolean),
        };
      })
      .filter(Boolean);
  }

  // Recent discussion — latest team-scoped tags on surfaced replays (same B71
  // privacy gate as the Discussion tab: inner-join tag_team_scope for THIS team).
  let recentDiscussion: any[] = [];
  if (surfaceSlugs.length > 0) {
    const discRows = await db
      .select({
        id: tags.id,
        replaySlug: tags.replaySlug,
        comment: tags.comment,
        createdAt: tags.createdAt,
        authorName: tags.authorName,
        authorUserName: users.name,
        authorImage: users.image,
        players: replays.players,
        ownerPlayerId: replays.ownerPlayerId,
      })
      .from(tags)
      .innerJoin(tagTeamScope, and(eq(tagTeamScope.tagId, tags.id), eq(tagTeamScope.teamSlug, slug)))
      .leftJoin(users, eq(users.id, tags.userId))
      .innerJoin(replays, eq(replays.slug, tags.replaySlug))
      .where(inArray(tags.replaySlug, surfaceSlugs))
      .orderBy(desc(tags.createdAt))
      .limit(DISCUSSION_PREVIEW);
    recentDiscussion = discRows.map((r) => {
      const players = orderPlayersOwnerFirst(r.players as any, r.ownerPlayerId) as any[];
      const names = players.map((p) => p?.username || p?.name).filter(Boolean);
      return {
        id: r.id,
        replaySlug: r.replaySlug,
        comment: r.comment ?? '',
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
        author: r.authorUserName || r.authorName || 'Someone',
        authorImage: r.authorImage ?? null,
        matchup: names.length >= 2 ? `${names[0]} vs ${names[1]}` : (names[0] || 'Replay'),
      };
    });
  }

  // Tournaments — count + the active/recent few (not completed), with entrant
  // and round counts for a progress summary.
  const tRows = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.teamSlug, slug))
    .orderBy(desc(tournaments.createdAt));
  const openTournamentRows = tRows.filter((t) => t.status !== 'completed').slice(0, OPEN_TOURNAMENTS);
  const openIds = openTournamentRows.map((t) => t.id);
  const entrantCounts = new Map<string, number>();
  const roundCounts = new Map<string, number>();
  if (openIds.length > 0) {
    const ec = await db
      .select({ id: tournamentEntrants.tournamentId, userId: tournamentEntrants.userId })
      .from(tournamentEntrants)
      .where(inArray(tournamentEntrants.tournamentId, openIds));
    for (const r of ec) entrantCounts.set(r.id, (entrantCounts.get(r.id) ?? 0) + 1);
    const rc = await db
      .select({ id: tournamentRounds.tournamentId })
      .from(tournamentRounds)
      .where(inArray(tournamentRounds.tournamentId, openIds));
    for (const r of rc) roundCounts.set(r.id, (roundCounts.get(r.id) ?? 0) + 1);
  }

  return NextResponse.json({
    ok: true,
    counts: {
      tournaments: tRows.length,
      openReviews: flagged.length,
      awaitingYou,
      surfacedReplays: surfaceSlugs.length,
      members: memberRows.length,
    },
    members: memberRows,
    openTournaments: openTournamentRows.map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      entrantCount: entrantCounts.get(t.id) ?? 0,
      roundCount: roundCounts.get(t.id) ?? 0,
      plannedRounds: t.plannedRounds ?? null,
      startedAt: t.startedAt ? t.startedAt.toISOString() : null,
    })),
    reviewReplays,
    recentDiscussion,
    recentReplays,
  });
}
