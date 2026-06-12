import { NextResponse } from 'next/server';
import { and, eq, inArray, count } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { replays, replayTeamShares, teamMembers, teams, tags, tagTeamScope } from '@/lib/schema';
import { authContextFromRequest, canMutateReplay } from '@/lib/replayPermissions';

export const runtime = 'nodejs';

// Owner check — shared predicate lives in lib/replayPermissions.
function isReplayOwner(replay: { userId: string | null; ownerToken: string }, req: Request, sessionUserId: string | null) {
  return canMutateReplay(replay, authContextFromRequest(req, sessionUserId));
}

// GET /api/replays/[slug]/team-shares — list teams this replay is shared
// with. Owner-only; surfaces the team names so the viewer can populate
// the share popover's checkbox list.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;

  const db = getDb();
  const [replay] = await db.select().from(replays).where(eq(replays.slug, slug)).limit(1);
  if (!replay) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  if (!(await isReplayOwner(replay, req, userId))) {
    return NextResponse.json({ ok: false, error: 'owner only' }, { status: 403 });
  }

  // Existing share rows for this replay.
  const shares = await db
    .select({ teamSlug: replayTeamShares.teamSlug, sharedAt: replayTeamShares.sharedAt, teamName: teams.name })
    .from(replayTeamShares)
    .innerJoin(teams, eq(teams.slug, replayTeamShares.teamSlug))
    .where(eq(replayTeamShares.replaySlug, slug));

  // The owner's teams (so the UI can show "share with team X" options
  // even for teams that haven't been shared to yet). Anonymous owners
  // (no userId) get an empty list — they can still see existing shares
  // but can't add new ones without an account.
  let ownerTeams: { slug: string; name: string }[] = [];
  if (userId) {
    const rows = await db
      .select({ slug: teams.slug, name: teams.name })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.slug, teamMembers.teamSlug))
      .where(eq(teamMembers.userId, userId));
    ownerTeams = rows;
  }

  // B100: per-team count of this replay's comments scoped to each team, so the
  // UI can warn before un-sharing ("this also removes N comments from team X's
  // discussion"). Un-sharing a team strips that team from those tags' scope
  // (DELETE below) to keep the audience ⊆ shares invariant.
  const scopeCountRows = await db
    .select({ teamSlug: tagTeamScope.teamSlug, n: count() })
    .from(tagTeamScope)
    .innerJoin(tags, eq(tags.id, tagTeamScope.tagId))
    .where(eq(tags.replaySlug, slug))
    .groupBy(tagTeamScope.teamSlug);
  const scopedTagCounts: Record<string, number> = {};
  for (const r of scopeCountRows) scopedTagCounts[r.teamSlug] = Number(r.n);

  // B133: the Share popover's Public toggle reads its initial state here.
  return NextResponse.json({ ok: true, shares, ownerTeams, scopedTagCounts, isPublic: !!replay.publicAt });
}

// POST /api/replays/[slug]/team-shares  body: { teamSlug }
// Owner-only. Caller must also be a member of the team.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'sign in required to share with teams' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const teamSlug: string = String(body.teamSlug || '').trim();
  if (!teamSlug) return NextResponse.json({ ok: false, error: 'teamSlug required' }, { status: 400 });

  const db = getDb();
  const [replay] = await db.select().from(replays).where(eq(replays.slug, slug)).limit(1);
  if (!replay) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  if (!(await isReplayOwner(replay, req, userId))) {
    return NextResponse.json({ ok: false, error: 'owner only' }, { status: 403 });
  }

  // Caller must be in the team they're sharing to. Otherwise anyone with
  // a team's slug could pollute the team's replay grid.
  const [membership] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamSlug, teamSlug), eq(teamMembers.userId, userId)))
    .limit(1);
  if (!membership) {
    return NextResponse.json({ ok: false, error: 'not a member of that team' }, { status: 403 });
  }

  // Idempotent insert.
  await db
    .insert(replayTeamShares)
    .values({ replaySlug: slug, teamSlug, sharedBy: userId })
    .onConflictDoNothing();

  return NextResponse.json({ ok: true });
}

// DELETE /api/replays/[slug]/team-shares  body: { teamSlug }
// Owner-only.
export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;

  const body = await req.json().catch(() => ({}));
  const teamSlug: string = String(body.teamSlug || '').trim();
  if (!teamSlug) return NextResponse.json({ ok: false, error: 'teamSlug required' }, { status: 400 });

  const db = getDb();
  const [replay] = await db.select().from(replays).where(eq(replays.slug, slug)).limit(1);
  if (!replay) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  if (!(await isReplayOwner(replay, req, userId))) {
    return NextResponse.json({ ok: false, error: 'owner only' }, { status: 403 });
  }

  await db
    .delete(replayTeamShares)
    .where(and(eq(replayTeamShares.replaySlug, slug), eq(replayTeamShares.teamSlug, teamSlug)));

  // Full un-share: also strip this team from the scope of every tag on the
  // replay. Without this the replay would still surface to the team via a
  // scoped tag (surfacing signal (a)) and the audience ⊆ shares invariant
  // would break. A tag scoped to no other team falls back to personal.
  const tagIds = (await db.select({ id: tags.id }).from(tags).where(eq(tags.replaySlug, slug))).map((t) => t.id);
  if (tagIds.length > 0) {
    await db
      .delete(tagTeamScope)
      .where(and(eq(tagTeamScope.teamSlug, teamSlug), inArray(tagTeamScope.tagId, tagIds)));
  }

  return NextResponse.json({ ok: true });
}
