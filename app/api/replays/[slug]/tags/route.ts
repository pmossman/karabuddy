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
import { isReplayOwnerViewer, loadTagScopes, resolveTagScope, tagVisibleToViewer, writeTagScope } from '@/lib/tagScope';
import { notifyMentions } from '@/lib/discordNotify';

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
    // B131: the replay OWNER sees every tag on their replay (feedback left by
    // others — incl. anonymous visitors' personal-scoped comments — is
    // addressed to them).
    const [replayRow] = await db
      .select({ userId: replays.userId, ownerToken: replays.ownerToken })
      .from(replays)
      .where(eq(replays.slug, slug))
      .limit(1);
    const isReplayOwner = !!replayRow && isReplayOwnerViewer(replayRow, { userId: viewerUserId, installToken });

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
          isReplayOwner,
        }),
      )
      .map((t) => ({ ...t, createdAt: t.createdAt.toISOString(), scope: Array.from(scopes.get(t.id) ?? []) }));

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
    const userId = await resolveUserId({ installToken });
    const id = generateTagId();
    // B55c: structured mentions { userIds[], teamSlugs[] }. Caller picks
    // these from the autocomplete popover; we trust + persist them. The
    // server doesn't re-parse the comment text — autocomplete is the
    // disambiguation layer (free-typed @something is just text).
    const mentions = sanitizeIncomingMentions(body.mentions);

    // B71: the comment's team audience. `teamSlugs` undefined → default scope
    // (all of the author's shared teams); an array → that explicit set,
    // clamped to (shares ∩ memberships).
    let requested = Array.isArray(body.teamSlugs)
      ? body.teamSlugs.filter((s: unknown) => typeof s === 'string')
      : undefined;
    let effectiveFrameIndex = frameIndex;
    let outgoingMentions = mentions;

    // B78: one-level reply threading. A reply (parentTagId set) inherits the
    // parent's frame + team scope and auto-@mentions the parent author so the
    // reply lands in their /mentions inbox. Replies can't be replied to.
    const parentTagId =
      typeof body.parentTagId === 'string' && body.parentTagId.trim() ? body.parentTagId.trim() : null;
    if (parentTagId) {
      const [parent] = await db
        .select()
        .from(tags)
        .where(and(eq(tags.id, parentTagId), eq(tags.replaySlug, slug)))
        .limit(1);
      if (!parent) return NextResponse.json({ ok: false, error: 'parent tag not found' }, { status: 404, headers });
      if (parent.parentTagId) {
        return NextResponse.json({ ok: false, error: 'cannot reply to a reply' }, { status: 400, headers });
      }
      effectiveFrameIndex = parent.frameIndex; // anchor the reply to the thread
      // Inherit the parent's audience (resolveTagScope still clamps to shares ∩
      // the replier's memberships) so a reply never escapes the thread's scope.
      const parentScopes = await loadTagScopes([parentTagId]);
      requested = Array.from(parentScopes.get(parentTagId) ?? []);
      // Auto-mention the parent author. The inbox's existing self-authored
      // exclusion means replying to your own comment doesn't self-notify.
      if (parent.userId && !outgoingMentions.userIds.includes(parent.userId)) {
        outgoingMentions = {
          userIds: [...outgoingMentions.userIds, parent.userId],
          teamSlugs: outgoingMentions.teamSlugs,
        };
      }
    }

    await db.insert(tags).values({
      id,
      replaySlug: slug,
      frameIndex: effectiveFrameIndex,
      userId,
      authorToken: installToken,
      authorName: session?.user?.name || authorName,
      comment,
      mentions: outgoingMentions.userIds.length || outgoingMentions.teamSlugs.length ? outgoingMentions : null,
      parentTagId,
    });
    const scope = await resolveTagScope({ replaySlug: slug, authorUserId: userId, requested });
    await writeTagScope(id, scope);
    // B81: fan the mention out to Discord (best-effort DM → team-channel ping →
    // inbox). Awaited but guarded — the tag is already persisted, so a Discord
    // failure can never fail the write; and notifyMentions returns near-instantly
    // when there are no mentions or no bot token. (Includes B78's reply
    // auto-mention of the parent author.) The upload-lift path is deliberately
    // NOT wired yet — periodic re-uploads would re-notify; needs insert-vs-update
    // dedup first.
    try {
      await notifyMentions({ mentions: outgoingMentions, replaySlug: slug, frameIndex: effectiveFrameIndex, comment, authorUserId: userId });
    } catch (e) {
      console.error('[karabuddy] notifyMentions failed (tag persisted):', e);
    }
    return NextResponse.json({ ok: true, id, scope }, { headers });
  } catch (err: any) {
    console.error('[karabuddy] POST /api/replays/:slug/tags failed:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'internal error' }, { status: 500, headers });
  }
}
