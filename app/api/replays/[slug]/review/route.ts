import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { replays, replayTeamShares } from '@/lib/schema';
import { authContextFromRequest, canMutateReplay } from '@/lib/replayPermissions';
import { notifyTeamReview } from '@/lib/reviewNotify';
import { revalidateForOps } from '@/lib/cached';

export const runtime = 'nodejs';

// POST /api/replays/[slug]/review — B135/B149: REQUEST (or cancel) a replay's
// review by a team.
//   body: { teamSlug, requested: boolean }
//   requested=true  → REQUEST review. Owner-only; the replay must already be
//                     shared with the team (the queue lives off the share row).
//   requested=false → CANCEL the request. Owner-only (B149: this is the ask, not
//                     the completion — members "mark reviewed" via /reviewed,
//                     which leaves a durable per-user mark and keeps the request
//                     open for more eyes).
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  const userId: string | null = session?.user?.id || null;

  const body = await req.json().catch(() => ({} as any));
  const teamSlug = String(body?.teamSlug || '').trim();
  const requested = body?.requested === true;
  if (!teamSlug) {
    return NextResponse.json({ ok: false, error: 'teamSlug required' }, { status: 400 });
  }

  const db = getDb();
  const [replay] = await db.select().from(replays).where(eq(replays.slug, slug)).limit(1);
  if (!replay) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });

  // The review flag lives on the replay's share to this team — it must exist.
  const [share] = await db
    .select()
    .from(replayTeamShares)
    .where(and(eq(replayTeamShares.replaySlug, slug), eq(replayTeamShares.teamSlug, teamSlug)))
    .limit(1);
  if (!share) {
    return NextResponse.json({ ok: false, error: 'replay is not shared with this team' }, { status: 400 });
  }

  // B149: requesting AND cancelling are both the owner's call (the request is
  // the ask; members complete it via per-user marks on /reviewed).
  const isOwner = canMutateReplay(replay, authContextFromRequest(req, userId));
  if (!isOwner) return NextResponse.json({ ok: false, error: 'owner only' }, { status: 403 });

  await db
    .update(replayTeamShares)
    .set({
      reviewRequestedAt: requested ? new Date() : null,
      reviewRequestedBy: requested ? userId : null,
    })
    .where(and(eq(replayTeamShares.replaySlug, slug), eq(replayTeamShares.teamSlug, teamSlug)));

  revalidateForOps([requested ? 'review-request' : 'review-cancel']); // refresh the team dashboard cache

  // B144: best-effort Discord post (review added/cleared) — never blocks the write.
  try {
    await notifyTeamReview({ replaySlug: slug, teamSlug, requested, actingUserId: userId });
  } catch (e) {
    console.error('[karabuddy] notifyTeamReview failed (review persisted):', e);
  }

  return NextResponse.json({ ok: true, reviewRequested: requested });
}
