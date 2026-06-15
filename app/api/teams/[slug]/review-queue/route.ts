import { NextResponse } from 'next/server';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { replays, replayTeamShares, replayAltPayload, users } from '@/lib/schema';
import { getTeamMembership } from '@/lib/teamSurface';
import { serializeReplayRow } from '@/lib/replayRow';
import { reviewersForTeam, commentersForTeam } from '@/lib/reviews';

export const runtime = 'nodejs';

// GET /api/teams/[slug]/review-queue — B135/B149: replays with an open review
// request for THIS team. Member-only, newest request first. Each row is enriched
// (B149) with the durable reviewer marks (who + when), whether YOU have reviewed,
// and the team-scoped commenters — so the tab can split "Needs review" vs
// "Reviewed" and "Awaiting your review" without anything vanishing.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  }
  const me = await getTeamMembership(slug, userId);
  if (!me) {
    return NextResponse.json({ ok: false, error: 'not a member' }, { status: 403 });
  }

  const db = getDb();
  const flagged = await db
    .select({
      replaySlug: replayTeamShares.replaySlug,
      requestedAt: replayTeamShares.reviewRequestedAt,
      requestedBy: replayTeamShares.reviewRequestedBy,
    })
    .from(replayTeamShares)
    .where(and(eq(replayTeamShares.teamSlug, slug), isNotNull(replayTeamShares.reviewRequestedAt)))
    .orderBy(desc(replayTeamShares.reviewRequestedAt));
  if (flagged.length === 0) {
    return NextResponse.json({ ok: true, data: [] });
  }
  const slugs = flagged.map((f) => f.replaySlug);
  const requestedAt = new Map(flagged.map((f) => [f.replaySlug, f.requestedAt]));
  const requestedBy = new Map(flagged.map((f) => [f.replaySlug, f.requestedBy]));

  const rows = await db
    .select({ replay: replays, ownerName: users.name })
    .from(replays)
    .leftJoin(users, eq(users.id, replays.userId))
    .where(inArray(replays.slug, slugs));

  const doubleSidedSlugs = new Set(
    (await db
      .select({ slug: replayAltPayload.replaySlug })
      .from(replayAltPayload)
      .where(inArray(replayAltPayload.replaySlug, slugs))).map((r) => r.slug),
  );

  // B149: durable reviewer marks + team-scoped commenters per replay.
  const reviewers = await reviewersForTeam(slugs, slug);
  const commenters = await commentersForTeam(slugs, slug);

  const data = rows
    .map(({ replay, ownerName }) => {
      const marks = reviewers.get(replay.slug) ?? [];
      return {
        ...serializeReplayRow(replay, {
          ownerName,
          viewerPlayerId: replay.ownerPlayerId ?? null,
          isMine: !!replay.userId && replay.userId === userId,
          doubleSided: doubleSidedSlugs.has(replay.slug),
        }),
        reviewRequestedAt: requestedAt.get(replay.slug)?.toISOString() ?? null,
        reviewRequestedBy: requestedBy.get(replay.slug) ?? null,
        reviewers: marks.map((m) => ({ userId: m.userId, name: m.name, reviewedAt: m.reviewedAt })),
        reviewerCount: marks.length,
        viewerReviewed: marks.some((m) => m.userId === userId),
        commenters: commenters.get(replay.slug)?.names ?? [],
        commentCount: commenters.get(replay.slug)?.count ?? 0,
      };
    })
    // Keep the queue order (newest request first).
    .sort((a, b) => (b.reviewRequestedAt ?? '').localeCompare(a.reviewRequestedAt ?? ''));

  return NextResponse.json({ ok: true, data });
}
