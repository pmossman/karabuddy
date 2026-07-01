import { NextResponse } from 'next/server';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { replayTeamShares, teams } from '@/lib/schema';
import { getMyTeamSlugs } from '@/lib/teamSurface';
import { reviewersForTeam, viewerCommentedSlugs } from '@/lib/reviews';

export const runtime = 'nodejs';

// GET /api/replays/[slug]/review-status — B149/ADR 0009: this replay's review
// state for the SIGNED-IN viewer, per team they're a member of that has an OPEN
// review request for it. Drives the viewer panel's review-status header
// (reviewer avatars + "✓ Mark reviewed", gated on having commented). Empty when
// the viewer isn't signed in or no relevant open request exists.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  const userId: string | null = session?.user?.id || null;
  if (!userId) return NextResponse.json({ ok: true, data: [] });

  const db = getDb();
  const myTeams = await getMyTeamSlugs(userId);
  if (myTeams.length === 0) return NextResponse.json({ ok: true, data: [] });

  // Open requests for this replay among the viewer's teams.
  const requests = await db
    .select({ teamSlug: replayTeamShares.teamSlug, teamName: teams.name, requestedAt: replayTeamShares.reviewRequestedAt })
    .from(replayTeamShares)
    .leftJoin(teams, eq(teams.slug, replayTeamShares.teamSlug))
    .where(and(
      eq(replayTeamShares.replaySlug, slug),
      inArray(replayTeamShares.teamSlug, myTeams),
      isNotNull(replayTeamShares.reviewRequestedAt),
    ));
  if (requests.length === 0) return NextResponse.json({ ok: true, data: [] });

  const data = await Promise.all(requests.map(async (r) => {
    const marks = (await reviewersForTeam([slug], r.teamSlug)).get(slug) ?? [];
    const commented = await viewerCommentedSlugs([slug], r.teamSlug, userId);
    return {
      teamSlug: r.teamSlug,
      teamName: r.teamName ?? r.teamSlug,
      requestedAt: r.requestedAt ? r.requestedAt.toISOString() : null,
      reviewers: marks.map((m) => ({ userId: m.userId, name: m.name, reviewedAt: m.reviewedAt })),
      reviewerCount: marks.length,
      viewerReviewed: marks.some((m) => m.userId === userId),
      viewerCommented: commented.has(slug),
    };
  }));

  return NextResponse.json({ ok: true, data });
}
