import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { tags } from '@/lib/schema';
import { corsHeaders, preflight } from '@/lib/cors';
import { resolveUserId } from '@/lib/userResolution';
import { getMyTeamSlugs } from '@/lib/teamSurface';
import { loadTagScopes, tagVisibleToViewer } from '@/lib/tagScope';
import { signMoment } from '@/lib/shareToken';

export const runtime = 'nodejs';

export function OPTIONS(req: Request) {
  return preflight(req);
}

// POST /api/replays/:slug/share-token
// Body: { frameIndex (ORIGINAL, 0-based), tagId }
// Header: X-Install-Token (optional).
//
// B113: mints a signed token that authorizes showing ONE specific tag in the
// link unfurl for this replay+frame — but ONLY after re-checking the caller can
// actually see that tag (the exact predicate the tags GET uses). This is the
// privacy boundary: you can never mint a token for a tag you can't see, so a
// shared link can't expose a teammate's private tag.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const headers = corsHeaders(req.headers.get('origin'));
  try {
    const { slug } = await params;
    const body = await req.json().catch(() => ({} as any));
    const tagId = String(body?.tagId || '').trim();
    const frameIndex = Number(body?.frameIndex);
    if (!tagId || !Number.isInteger(frameIndex) || frameIndex < 0) {
      return NextResponse.json({ ok: false, error: 'tagId + frameIndex required' }, { status: 400, headers });
    }

    const installToken = (req.headers.get('x-install-token') || '').trim() || null;
    const viewerUserId = await resolveUserId({ installToken });
    const viewerTeams = new Set(viewerUserId ? await getMyTeamSlugs(viewerUserId) : []);

    const db = getDb();
    const [tag] = await db
      .select()
      .from(tags)
      .where(and(eq(tags.id, tagId), eq(tags.replaySlug, slug)))
      .limit(1);
    if (!tag || tag.frameIndex !== frameIndex) {
      return NextResponse.json({ ok: false, error: 'tag not found' }, { status: 404, headers });
    }

    const scope = (await loadTagScopes([tagId])).get(tagId) ?? new Set<string>();
    const allowed = tagVisibleToViewer(tag, scope, { userId: viewerUserId, installToken, teams: viewerTeams });
    if (!allowed) {
      return NextResponse.json({ ok: false, error: 'not allowed' }, { status: 403, headers });
    }

    const token = signMoment({ slug, frameIndex, tagId });
    const url = `${new URL(req.url).origin}/r/${slug}?f=${frameIndex + 1}&t=${token}`;
    return NextResponse.json({ ok: true, token, url }, { headers });
  } catch (err: any) {
    console.error('[karabuddy] POST /api/replays/:slug/share-token failed:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'internal error' }, { status: 500, headers });
  }
}
