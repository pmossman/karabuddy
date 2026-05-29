import { NextResponse } from 'next/server';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { replays, replayTeamShares, tags, teamMembers } from '@/lib/schema';

export const runtime = 'nodejs';

// GET /api/teams/[slug]/replays — list replays surfaced to this team.
// Member-only. Surfacing rules per B55b:
//   (a) Any team member has tagged the replay — implicit signal
//   (b) Replay was explicitly shared with the team via the share table
// Returns ReplayCard-shaped data sorted by createdAt desc.
//
// We could express this as a UNION but two parallel queries + a Set
// merge is simpler and at our scale (≤ 100s of replays per team) more
// than fast enough.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  }

  const db = getDb();
  // Membership gate — same pattern as /api/teams/[slug]
  const [me] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamSlug, slug), eq(teamMembers.userId, userId)))
    .limit(1);
  if (!me) {
    return NextResponse.json({ ok: false, error: 'not a member' }, { status: 403 });
  }

  // Collect this team's member userIds for the tag-author filter.
  const memberRows = await db
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(eq(teamMembers.teamSlug, slug));
  const memberIds = memberRows.map((m) => m.userId);

  // Signal (a): replays tagged by any team member. Drizzle's inArray
  // returns an empty result if the array is empty — short-circuit just
  // in case a team somehow has zero members.
  const taggedSlugs = memberIds.length > 0
    ? await db
        .selectDistinct({ slug: tags.replaySlug })
        .from(tags)
        .where(inArray(tags.userId, memberIds))
    : [];

  // Signal (b): explicit shares.
  const sharedRows = await db
    .select({ slug: replayTeamShares.replaySlug })
    .from(replayTeamShares)
    .where(eq(replayTeamShares.teamSlug, slug));

  const surfaceSlugs = Array.from(
    new Set([...taggedSlugs.map((r) => r.slug), ...sharedRows.map((r) => r.slug)])
  );

  if (surfaceSlugs.length === 0) {
    return NextResponse.json({ ok: true, data: [] });
  }

  const rows = await db
    .select()
    .from(replays)
    .where(inArray(replays.slug, surfaceSlugs))
    .orderBy(desc(replays.createdAt))
    .limit(200);

  return NextResponse.json({ ok: true, data: rows });
}
