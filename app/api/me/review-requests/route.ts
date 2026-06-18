import { NextResponse } from 'next/server';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { replays, replayTeamShares, teams, users } from '@/lib/schema';
import { serializeReplayRow } from '@/lib/replayRow';
import { gameIdsWithSibling } from '@/lib/doubleSided';
import { reviewCountsByShare } from '@/lib/reviews';

export const runtime = 'nodejs';

// GET /api/me/review-requests — B149/ADR 0009: the review requests the current
// user opened (review_requested_by = me), across all their teams, each enriched
// with the reviewer marks for that team. Drives the requester's "your requests +
// who reviewed" surface (home block + /replays?tab=mine indicator).
export async function GET() {
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });

  const db = getDb();
  const requests = await db
    .select({
      replaySlug: replayTeamShares.replaySlug,
      teamSlug: replayTeamShares.teamSlug,
      teamName: teams.name,
      requestedAt: replayTeamShares.reviewRequestedAt,
    })
    .from(replayTeamShares)
    .leftJoin(teams, eq(teams.slug, replayTeamShares.teamSlug))
    .where(and(eq(replayTeamShares.reviewRequestedBy, userId), isNotNull(replayTeamShares.reviewRequestedAt)))
    .orderBy(desc(replayTeamShares.reviewRequestedAt));
  if (requests.length === 0) return NextResponse.json({ ok: true, data: [] });

  const slugs = [...new Set(requests.map((r) => r.replaySlug))];
  const rows = await db
    .select({ replay: replays, ownerName: users.name })
    .from(replays)
    .leftJoin(users, eq(users.id, replays.userId))
    .where(inArray(replays.slug, slugs));
  const replayBySlug = new Map(rows.map((r) => [r.replay.slug, r]));
  // B166: "both POVs" = the game has >=2 distinct recorders (a sibling row).
  const dsGames = await gameIdsWithSibling(rows.map((r) => r.replay.gameId));
  const marksByShare = await reviewCountsByShare(slugs);

  // One entry per (replay, team) request — the requester can ask multiple teams.
  const data = requests
    .map((req) => {
      const r = replayBySlug.get(req.replaySlug);
      if (!r) return null;
      const marks = marksByShare.get(`${req.replaySlug}::${req.teamSlug}`) ?? [];
      return {
        ...serializeReplayRow(r.replay, {
          ownerName: r.ownerName,
          viewerPlayerId: r.replay.ownerPlayerId ?? null,
          isMine: true,
          doubleSided: dsGames.has(r.replay.gameId),
        }),
        teamSlug: req.teamSlug,
        teamName: req.teamName ?? req.teamSlug,
        reviewRequestedAt: req.requestedAt?.toISOString() ?? null,
        reviewers: marks.map((m) => ({ userId: m.userId, name: m.name, reviewedAt: m.reviewedAt })),
        reviewerCount: marks.length,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return NextResponse.json({ ok: true, data });
}
