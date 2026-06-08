import { NextResponse } from 'next/server';
import { and, desc, eq, inArray, count } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { replays, users, teamMembers, replayParticipants, tags, tagTeamScope } from '@/lib/schema';
import { getTeamMembership, surfacedReplaySlugs } from '@/lib/teamSurface';
import { serializeReplayRow } from '@/lib/replayRow';

export const runtime = 'nodejs';

// GET /api/teams/[slug]/replays — list replays surfaced to this team.
// Member-only. Surfacing rule lives in lib/teamSurface; this route is
// the thin shell that joins user names + sorts.
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

  const surfaceSlugs = await surfacedReplaySlugs([slug]);
  if (surfaceSlugs.length === 0) {
    return NextResponse.json({ ok: true, data: [] });
  }

  const db = getDb();
  // B84: account-based intra-team detection. A replay is "internal"
  // (teammate-vs-teammate) when 2+ of its RECORDERS (replay_participants, by
  // karabuddy account) are members of this team — no karabast usernames.
  const memberIds = (await db
    .select({ id: teamMembers.userId })
    .from(teamMembers)
    .where(eq(teamMembers.teamSlug, slug))).map((r) => r.id);
  const partRows = memberIds.length > 0
    ? await db
        .select({ replaySlug: replayParticipants.replaySlug, userId: replayParticipants.userId })
        .from(replayParticipants)
        .where(and(inArray(replayParticipants.replaySlug, surfaceSlugs), inArray(replayParticipants.userId, memberIds)))
    : [];
  const teammatesByReplay = new Map<string, Set<string>>();
  for (const p of partRows) {
    let s = teammatesByReplay.get(p.replaySlug);
    if (!s) { s = new Set(); teammatesByReplay.set(p.replaySlug, s); }
    s.add(p.userId);
  }

  // B100: comments visible to THIS team per replay (tags scoped to the team
  // via tag_team_scope — same rule the discussion feed counts by), so the
  // team grid can show which replays have active discussion at a glance.
  const commentCountBySlug = new Map<string, number>();
  const countRows = await db
    .select({ replaySlug: tags.replaySlug, n: count() })
    .from(tags)
    .innerJoin(tagTeamScope, eq(tagTeamScope.tagId, tags.id))
    .where(and(inArray(tags.replaySlug, surfaceSlugs), eq(tagTeamScope.teamSlug, slug)))
    .groupBy(tags.replaySlug);
  for (const c of countRows) commentCountBySlug.set(c.replaySlug, Number(c.n));

  const rows = await db
    .select({ replay: replays, ownerName: users.name })
    .from(replays)
    .leftJoin(users, eq(users.id, replays.userId))
    .where(inArray(replays.slug, surfaceSlugs))
    .orderBy(desc(replays.createdAt))
    .limit(200);

  // B116: serialize via the shared serializer (one wire shape with the personal
  // library; also stops leaking ownerToken/payloadBlobUrl that the old `...replay`
  // spread sent over the wire). Team perspective = the UPLOADER, so "my leader" /
  // "opponent leader" filters read the canonical owner's side. `isMine` still
  // lets the owner manage (un-share) their own replay from the team grid.
  const flat = rows.map(({ replay, ownerName }) => serializeReplayRow(replay, {
    ownerName,
    viewerPlayerId: replay.ownerPlayerId ?? null,
    internal: (teammatesByReplay.get(replay.slug)?.size ?? 0) >= 2,
    commentCount: commentCountBySlug.get(replay.slug) ?? 0,
    isMine: !!replay.userId && replay.userId === userId,
  }));
  return NextResponse.json({ ok: true, data: flat });
}
