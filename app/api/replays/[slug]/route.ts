import { NextResponse } from 'next/server';
import { eq, asc } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { replays, tags } from '@/lib/schema';
import { corsHeaders, preflight } from '@/lib/cors';
import { auth } from '@/auth';

export const runtime = 'nodejs';

export function OPTIONS(req: Request) {
  return preflight(req);
}

// Ownership: signed-in user matching replays.userId, OR caller holding the
// original installToken (X-Install-Token header). Mirrors the tag CRUD
// pattern so an extension can still mutate its own anonymous uploads
// before the user links/claims them.
async function canMutate(row: { userId: string | null; ownerToken: string }, req: Request) {
  const session = await auth();
  const sessionUserId: string | null = (session?.user as any)?.id || null;
  if (sessionUserId && row.userId === sessionUserId) return true;
  const headerToken = req.headers.get('x-install-token');
  if (headerToken && row.ownerToken === headerToken) return true;
  return false;
}

// GET /api/replays/:slug — metadata + tags + payload URL.
// Returns the Blob URL so the client can fetch the full payload directly
// from Vercel Blob (saves a hop through our function for a possibly-MB
// JSON body).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const headers = corsHeaders(req.headers.get('origin'));
  try {
    const { slug } = await params;
    const db = getDb();
    const [row] = await db.select().from(replays).where(eq(replays.slug, slug)).limit(1);
    if (!row) {
      return NextResponse.json({ ok: false, error: 'not found' }, { status: 404, headers });
    }
    const tagRows = await db
      .select()
      .from(tags)
      .where(eq(tags.replaySlug, slug))
      .orderBy(asc(tags.frameIndex));
    return NextResponse.json({ ok: true, data: { ...row, tags: tagRows } }, { headers });
  } catch (err: any) {
    console.error('[karabuddy] GET /api/replays/:slug failed:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'internal error' }, { status: 500, headers });
  }
}

// PATCH /api/replays/:slug  { visibility?: 'unlisted' | 'public' }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const headers = corsHeaders(req.headers.get('origin'));
  try {
    const { slug } = await params;
    const db = getDb();
    const [row] = await db.select().from(replays).where(eq(replays.slug, slug)).limit(1);
    if (!row) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404, headers });
    if (!(await canMutate(row, req))) {
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403, headers });
    }
    const body = await req.json().catch(() => ({}));
    const update: Partial<{ visibility: string }> = {};
    if (typeof body.visibility === 'string' && ['unlisted', 'public'].includes(body.visibility)) {
      update.visibility = body.visibility;
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ ok: false, error: 'nothing to update' }, { status: 400, headers });
    }
    await db.update(replays).set(update).where(eq(replays.slug, slug));
    return NextResponse.json({ ok: true }, { headers });
  } catch (err: any) {
    console.error('[karabuddy] PATCH /api/replays/:slug failed:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'internal error' }, { status: 500, headers });
  }
}

// DELETE /api/replays/:slug — owner-locked. Cascades to tags via FK.
// (Blob cleanup is best-effort and async; orphans are harmless.)
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const headers = corsHeaders(req.headers.get('origin'));
  try {
    const { slug } = await params;
    const db = getDb();
    const [row] = await db.select().from(replays).where(eq(replays.slug, slug)).limit(1);
    if (!row) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404, headers });
    if (!(await canMutate(row, req))) {
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403, headers });
    }
    await db.delete(replays).where(eq(replays.slug, slug));
    return NextResponse.json({ ok: true }, { headers });
  } catch (err: any) {
    console.error('[karabuddy] DELETE /api/replays/:slug failed:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'internal error' }, { status: 500, headers });
  }
}
