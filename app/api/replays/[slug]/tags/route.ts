import { NextResponse } from 'next/server';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { replays, replayTeamShares, tags, teams } from '@/lib/schema';
import { generateTagId } from '@/lib/slug';
import { corsHeaders, preflight } from '@/lib/cors';
import { resolveUserId } from '@/lib/userResolution';
import { auth } from '@/auth';
import { sanitizeIncomingMentions } from '@/lib/mentions';
import { getMyTeamSlugs } from '@/lib/teamSurface';
import { loadTagScopes, resolveTagScope, tagVisibleToViewer, writeTagScope } from '@/lib/tagScope';

export const runtime = 'nodejs';

export function OPTIONS(req: Request) {
  return preflight(req);
}

// GET /api/replays/:slug/tags
// Header: X-Install-Token (optional — identifies an anonymous author).
// B71: the viewer fetches its tags here (rather than SSR) so the server
// can scope them to the viewer. Returns only tags the caller may see:
// their own (by account or install token) + tags scoped to a team they
// belong to. Personal tags by others, and other teams' tags, are withheld.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const headers = corsHeaders(req.headers.get('origin'));
  try {
    const { slug } = await params;
    const installToken = (req.headers.get('x-install-token') || '').trim() || null;
    const viewerUserId = await resolveUserId({ installToken });
    const viewerTeams = new Set(viewerUserId ? await getMyTeamSlugs(viewerUserId) : []);

    const db = getDb();
    const rows = await db
      .select()
      .from(tags)
      .where(eq(tags.replaySlug, slug))
      .orderBy(asc(tags.frameIndex));
    const scopes = await loadTagScopes(rows.map((t) => t.id));

    const visible = rows
      .filter((t) =>
        tagVisibleToViewer(t, scopes.get(t.id) ?? new Set(), {
          userId: viewerUserId,
          installToken,
          teams: viewerTeams,
        }),
      )
      .map((t) => ({ ...t, createdAt: t.createdAt.toISOString() }));

    // B71: the comment form's scope chip needs the teams THIS viewer can
    // scope a comment to here — i.e. teams they belong to that the replay
    // is shared with (audience ⊆ shares). Empty/one-team → no chip shown.
    let armedTeams: { slug: string; name: string }[] = [];
    if (viewerTeams.size > 0) {
      armedTeams = await db
        .select({ slug: teams.slug, name: teams.name })
        .from(replayTeamShares)
        .innerJoin(teams, eq(teams.slug, replayTeamShares.teamSlug))
        .where(and(eq(replayTeamShares.replaySlug, slug), inArray(replayTeamShares.teamSlug, Array.from(viewerTeams))));
    }

    return NextResponse.json({ ok: true, data: visible, armedTeams }, { headers });
  } catch (err: any) {
    console.error('[karabuddy] GET /api/replays/:slug/tags failed:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'internal error' }, { status: 500, headers });
  }
}

// POST /api/replays/:slug/tags
// Body: { installToken, authorName, frameIndex, comment?, teamSlugs? }
// B71: teamSlugs is the comment's audience (subset of the replay's
// shares). Omit → defaults to all of the author's shared teams; [] →
// personal. resolveTagScope clamps it to (shares ∩ author memberships).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const headers = corsHeaders(req.headers.get('origin'));
  try {
    const { slug } = await params;
    const body = await req.json();
    const installToken: string = String(body.installToken || '').trim();
    const authorName: string = String(body.authorName || '').trim();
    const frameIndex = Number(body.frameIndex);
    const comment: string = String(body.comment || '');
    if (!installToken) return NextResponse.json({ ok: false, error: 'installToken required' }, { status: 400, headers });
    if (!authorName) return NextResponse.json({ ok: false, error: 'authorName required' }, { status: 400, headers });
    if (!Number.isFinite(frameIndex) || frameIndex < 0) {
      return NextResponse.json({ ok: false, error: 'frameIndex must be a non-negative number' }, { status: 400, headers });
    }
    const db = getDb();
    const [exists] = await db.select({ slug: replays.slug }).from(replays).where(eq(replays.slug, slug)).limit(1);
    if (!exists) return NextResponse.json({ ok: false, error: 'replay not found' }, { status: 404, headers });
    // Attribute via the same path as uploads: session → linked extension
    // token → karabast username match → null (anonymous, token-locked).
    const session = await auth();
    const userId = await resolveUserId({ installToken, recordedUsername: null });
    const id = generateTagId();
    // B55c: structured mentions { userIds[], teamSlugs[] }. Caller picks
    // these from the autocomplete popover; we trust + persist them. The
    // server doesn't re-parse the comment text — autocomplete is the
    // disambiguation layer (free-typed @something is just text).
    const mentions = sanitizeIncomingMentions(body.mentions);
    await db.insert(tags).values({
      id,
      replaySlug: slug,
      frameIndex,
      userId,
      authorToken: installToken,
      authorName: session?.user?.name || authorName,
      comment,
      mentions: mentions.userIds.length || mentions.teamSlugs.length ? mentions : null,
    });
    // B71: persist the comment's team audience. `teamSlugs` undefined →
    // default scope (all of the author's shared teams); an array → that
    // explicit set, clamped to (shares ∩ memberships).
    const requested = Array.isArray(body.teamSlugs)
      ? body.teamSlugs.filter((s: unknown) => typeof s === 'string')
      : undefined;
    const scope = await resolveTagScope({ replaySlug: slug, authorUserId: userId, requested });
    await writeTagScope(id, scope);
    return NextResponse.json({ ok: true, id, scope }, { headers });
  } catch (err: any) {
    console.error('[karabuddy] POST /api/replays/:slug/tags failed:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'internal error' }, { status: 500, headers });
  }
}
