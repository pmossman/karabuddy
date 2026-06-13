import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { clips, replays } from '@/lib/schema';
import { corsHeaders, preflight } from '@/lib/cors';
import { authContextFromRequest, canMutateClip } from '@/lib/replayPermissions';
import { canViewReplayIdentities } from '@/lib/altPerspective';
import { isSampleReplaySlug } from '@/lib/sampleReplays';
import { orderPlayersOwnerFirst } from '@/lib/players';
import { anonymizePlayersSummary } from '@/lib/anonymizeReplay';

export const runtime = 'nodejs';

export function OPTIONS(req: Request) {
  return preflight(req);
}

// GET /api/clips/[slug] — B136: the clip + the minimal parent-replay fields the
// reel player needs (payload URL, players, perspective, match meta). PUBLIC,
// link-accessible like a replay; identities anonymize for non-entitled viewers
// (and samples), reusing the replay rule.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const headers = corsHeaders(req.headers.get('origin'));
  try {
    const { slug } = await params;
    const db = getDb();
    const [clip] = await db.select().from(clips).where(eq(clips.slug, slug)).limit(1);
    if (!clip) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404, headers });
    const [replay] = await db.select().from(replays).where(eq(replays.slug, clip.replaySlug)).limit(1);
    if (!replay) return NextResponse.json({ ok: false, error: 'replay gone' }, { status: 404, headers });

    const session = await auth();
    const sessionUserId: string | null = (session?.user as any)?.id || null;
    const ctx = authContextFromRequest(req, sessionUserId);
    const anonymize = isSampleReplaySlug(replay.slug) || !(await canViewReplayIdentities(replay, ctx));
    const ordered = orderPlayersOwnerFirst((replay as any).players, (replay as any).ownerPlayerId);

    const replayData = {
      slug: replay.slug,
      payloadBlobUrl: (replay as any).payloadBlobUrl,
      players: anonymize ? anonymizePlayersSummary(ordered as any[]) : ordered,
      ownerPlayerId: anonymize ? null : (replay as any).ownerPlayerId ?? null,
      match: (replay as any).match ?? null,
      displayName: (replay as any).displayName ?? null,
    };
    const clipData = {
      slug: clip.slug,
      replaySlug: clip.replaySlug,
      startFrame: clip.startFrame,
      endFrame: clip.endFrame,
      title: clip.title,
      createdAt: clip.createdAt.toISOString(),
      // Whether THIS caller can delete it (creator or replay owner) — drives the
      // viewer's delete affordance. No identity leak (a boolean).
      canDelete: canMutateClip(clip, replay as any, ctx),
    };
    return NextResponse.json({ ok: true, data: { clip: clipData, replay: replayData } }, { headers });
  } catch (err: any) {
    console.error('[karabuddy] GET /api/clips/:slug failed:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'internal error' }, { status: 500, headers });
  }
}

// DELETE /api/clips/[slug] — B136: the clip creator OR the replay owner.
export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const headers = corsHeaders(req.headers.get('origin'));
  try {
    const { slug } = await params;
    const db = getDb();
    const [clip] = await db.select().from(clips).where(eq(clips.slug, slug)).limit(1);
    if (!clip) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404, headers });
    const [replay] = await db.select().from(replays).where(eq(replays.slug, clip.replaySlug)).limit(1);

    const session = await auth();
    const sessionUserId: string | null = (session?.user as any)?.id || null;
    const ctx = authContextFromRequest(req, sessionUserId);
    if (!canMutateClip(clip, (replay as any) ?? { userId: null, ownerToken: '' }, ctx)) {
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403, headers });
    }
    await db.delete(clips).where(eq(clips.slug, slug));
    return NextResponse.json({ ok: true }, { headers });
  } catch (err: any) {
    console.error('[karabuddy] DELETE /api/clips/:slug failed:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'internal error' }, { status: 500, headers });
  }
}
