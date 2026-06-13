import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { replays, clips } from '@/lib/schema';
import { generateClipSlug } from '@/lib/slug';
import { corsHeaders, preflight } from '@/lib/cors';

export const runtime = 'nodejs';

export function OPTIONS(req: Request) {
  return preflight(req);
}

// GET /api/replays/[slug]/clips — list a replay's clips (newest first). Public,
// link-accessible (same as the replay). Bare list — the clip viewer fetches the
// rest.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const headers = corsHeaders(req.headers.get('origin'));
  try {
    const { slug } = await params;
    const db = getDb();
    const rows = await db
      .select({ slug: clips.slug, startFrame: clips.startFrame, endFrame: clips.endFrame, title: clips.title, createdAt: clips.createdAt })
      .from(clips)
      .where(eq(clips.replaySlug, slug))
      .orderBy(desc(clips.createdAt))
      .limit(100);
    return NextResponse.json({ ok: true, data: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) }, { headers });
  } catch (err: any) {
    console.error('[karabuddy] GET /api/replays/:slug/clips failed:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'internal error' }, { status: 500, headers });
  }
}

// POST /api/replays/[slug]/clips — B136: ANY viewer creates a clip.
//   Header: X-Install-Token (identifies an anonymous creator).
//   Body: { startFrame, endFrame, title? } — frames in ORIGINAL space (the
//   client converts from the collapsed timeline it's viewing). Bounds are
//   trusted+clamped on read (the client computed them from the real replay);
//   we only sanity-check ordering so a clip can't be empty/inverted.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const headers = corsHeaders(req.headers.get('origin'));
  try {
    const { slug } = await params;
    const session = await auth();
    const userId: string | null = (session?.user as any)?.id || null;
    const installToken = (req.headers.get('x-install-token') || '').trim() || null;
    const createdBy = userId ?? installToken;
    if (!createdBy) {
      return NextResponse.json({ ok: false, error: 'sign in or an install token is required' }, { status: 401, headers });
    }

    const body = await req.json().catch(() => ({} as any));
    const startFrame = Number(body?.startFrame);
    const endFrame = Number(body?.endFrame);
    if (!Number.isInteger(startFrame) || !Number.isInteger(endFrame) || startFrame < 0 || endFrame <= startFrame) {
      return NextResponse.json({ ok: false, error: 'startFrame/endFrame must be integers with 0 ≤ start < end' }, { status: 400, headers });
    }
    if (endFrame - startFrame > 100000) {
      return NextResponse.json({ ok: false, error: 'clip range too large' }, { status: 400, headers });
    }
    const rawTitle = typeof body?.title === 'string' ? body.title.trim().slice(0, 80) : '';
    const title = rawTitle.length > 0 ? rawTitle : null;

    const db = getDb();
    const [replay] = await db.select({ slug: replays.slug }).from(replays).where(eq(replays.slug, slug)).limit(1);
    if (!replay) return NextResponse.json({ ok: false, error: 'replay not found' }, { status: 404, headers });

    const clipSlug = generateClipSlug();
    await db.insert(clips).values({ slug: clipSlug, replaySlug: slug, startFrame, endFrame, title, userId, createdBy });
    return NextResponse.json({ ok: true, slug: clipSlug }, { headers });
  } catch (err: any) {
    console.error('[karabuddy] POST /api/replays/:slug/clips failed:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'internal error' }, { status: 500, headers });
  }
}
