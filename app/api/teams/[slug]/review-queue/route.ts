import { NextResponse } from 'next/server';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { replays, replayTeamShares, replayAltPayload, users } from '@/lib/schema';
import { getTeamMembership } from '@/lib/teamSurface';
import { serializeReplayRow } from '@/lib/replayRow';

export const runtime = 'nodejs';

// GET /api/teams/[slug]/review-queue — B135: replays the uploader flagged for
// review by THIS team (review_requested_at set on the share). Member-only.
// Newest request first. Reuses the shared serializer; the team perspective is
// the uploader's side, same as the team replay grid.
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
    .select({ replaySlug: replayTeamShares.replaySlug, requestedAt: replayTeamShares.reviewRequestedAt })
    .from(replayTeamShares)
    .where(and(eq(replayTeamShares.teamSlug, slug), isNotNull(replayTeamShares.reviewRequestedAt)))
    .orderBy(desc(replayTeamShares.reviewRequestedAt));
  if (flagged.length === 0) {
    return NextResponse.json({ ok: true, data: [] });
  }
  const slugs = flagged.map((f) => f.replaySlug);
  const requestedAt = new Map(flagged.map((f) => [f.replaySlug, f.requestedAt]));

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

  const data = rows
    .map(({ replay, ownerName }) => ({
      ...serializeReplayRow(replay, {
        ownerName,
        viewerPlayerId: replay.ownerPlayerId ?? null,
        isMine: !!replay.userId && replay.userId === userId,
        doubleSided: doubleSidedSlugs.has(replay.slug),
      }),
      reviewRequestedAt: requestedAt.get(replay.slug)?.toISOString() ?? null,
    }))
    // Keep the queue order (newest request first).
    .sort((a, b) => (b.reviewRequestedAt ?? '').localeCompare(a.reviewRequestedAt ?? ''));

  return NextResponse.json({ ok: true, data });
}
