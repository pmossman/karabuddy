import { NextResponse } from 'next/server';
import { and, eq, isNotNull } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { replays, replayTeamShares } from '@/lib/schema';
import { getTeamMembership } from '@/lib/teamSurface';
import { markReviewed, unmarkReviewed, viewerCommentedSlugs } from '@/lib/reviews';
import { notifyReviewMark } from '@/lib/reviewNotify';

export const runtime = 'nodejs';

// POST /api/replays/[slug]/reviewed — B149/ADR 0009: the acting MEMBER's own "I
// reviewed this" mark for a team. Distinct from /review (the owner's request):
// marks are per-user and durable, so the request stays open for more eyes.
//   body: { teamSlug, reviewed: boolean }
// Gated to a member of the team, and only on a replay with an OPEN request for
// that team (requested-only, v1 — keeps the queue/marks coherent).
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  const userId: string | null = session?.user?.id || null;
  if (!userId) return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const teamSlug = String(body?.teamSlug || '').trim();
  const reviewed = body?.reviewed === true;
  if (!teamSlug) return NextResponse.json({ ok: false, error: 'teamSlug required' }, { status: 400 });

  const db = getDb();
  const [replay] = await db.select({ slug: replays.slug }).from(replays).where(eq(replays.slug, slug)).limit(1);
  if (!replay) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });

  const member = await getTeamMembership(teamSlug, userId);
  if (!member) return NextResponse.json({ ok: false, error: 'not a team member' }, { status: 403 });

  // Requested-only: the share must have an open review request for this team.
  const [share] = await db
    .select({ replaySlug: replayTeamShares.replaySlug })
    .from(replayTeamShares)
    .where(and(
      eq(replayTeamShares.replaySlug, slug),
      eq(replayTeamShares.teamSlug, teamSlug),
      isNotNull(replayTeamShares.reviewRequestedAt),
    ))
    .limit(1);
  if (!share) return NextResponse.json({ ok: false, error: 'no open review request for this team' }, { status: 400 });

  if (reviewed) {
    // A review means you left feedback — gate the mark on a team-scoped comment.
    const commented = await viewerCommentedSlugs([slug], teamSlug, userId);
    if (!commented.has(slug)) {
      return NextResponse.json({ ok: false, error: 'leave a comment for the team before marking reviewed' }, { status: 400 });
    }
    await markReviewed(slug, teamSlug, userId);
  } else {
    await unmarkReviewed(slug, teamSlug, userId);
  }

  // Best-effort Discord post on a NEW mark (never blocks the write).
  if (reviewed) {
    try {
      await notifyReviewMark({ replaySlug: slug, teamSlug, actingUserId: userId });
    } catch (e) {
      console.error('[karabuddy] notifyReviewMark failed (mark persisted):', e);
    }
  }

  return NextResponse.json({ ok: true, reviewed });
}
