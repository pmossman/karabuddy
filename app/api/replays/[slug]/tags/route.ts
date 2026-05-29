import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { replays, tags } from '@/lib/schema';
import { generateTagId } from '@/lib/slug';
import { corsHeaders, preflight } from '@/lib/cors';
import { resolveUserId } from '@/lib/userResolution';
import { auth } from '@/auth';
import { sanitizeIncomingMentions } from '@/lib/mentions';

export const runtime = 'nodejs';

export function OPTIONS(req: Request) {
  return preflight(req);
}

// POST /api/replays/:slug/tags
// Body: { installToken, authorName, frameIndex, comment? }
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
    return NextResponse.json({ ok: true, id }, { headers });
  } catch (err: any) {
    console.error('[karabuddy] POST /api/replays/:slug/tags failed:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'internal error' }, { status: 500, headers });
  }
}
