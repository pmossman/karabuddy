import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { replays, tags } from '@/lib/schema';
import { corsHeaders, preflight } from '@/lib/cors';
import { auth } from '@/auth';

// Edit (PATCH): tag author only — signed-in user matches tag.userId, OR
// the X-Install-Token header matches tag.authorToken. Replay owners
// deliberately cannot edit other people's tags (don't put words in mouths).
async function canEdit(row: { userId: string | null; authorToken: string }, req: Request): Promise<boolean> {
  const session = await auth();
  const sessionUserId: string | null = (session?.user as any)?.id || null;
  if (sessionUserId && row.userId === sessionUserId) return true;
  const headerToken = req.headers.get('x-install-token');
  if (headerToken && row.authorToken === headerToken) return true;
  return false;
}

// Delete (DELETE): tag author OR replay owner. Replay owner = session user
// matches replays.userId for the slug, OR X-Install-Token matches
// replays.ownerToken. Lets replay owners clean up spam comments on their
// own replays.
async function canDelete(
  row: { userId: string | null; authorToken: string },
  slug: string,
  req: Request,
): Promise<boolean> {
  if (await canEdit(row, req)) return true;
  const db = getDb();
  const [replay] = await db
    .select({ userId: replays.userId, ownerToken: replays.ownerToken })
    .from(replays)
    .where(eq(replays.slug, slug))
    .limit(1);
  if (!replay) return false;
  const session = await auth();
  const sessionUserId: string | null = (session?.user as any)?.id || null;
  if (sessionUserId && replay.userId === sessionUserId) return true;
  const headerToken = req.headers.get('x-install-token');
  if (headerToken && replay.ownerToken === headerToken) return true;
  return false;
}

export const runtime = 'nodejs';

export function OPTIONS(req: Request) {
  return preflight(req);
}

// PATCH /api/replays/:slug/tags/:id — edit own comment.
// X-Install-Token header must match the tag's authorToken.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  const headers = corsHeaders(req.headers.get('origin'));
  try {
    const { slug, id } = await params;
    const body = await req.json().catch(() => ({}));
    const comment: string = String(body.comment ?? '');
    const db = getDb();
    const [row] = await db
      .select()
      .from(tags)
      .where(and(eq(tags.id, id), eq(tags.replaySlug, slug)))
      .limit(1);
    if (!row) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404, headers });
    if (!(await canEdit(row, req))) {
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403, headers });
    }
    await db.update(tags).set({ comment }).where(eq(tags.id, id));
    return NextResponse.json({ ok: true }, { headers });
  } catch (err: any) {
    console.error('[karabuddy] PATCH tag failed:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'internal error' }, { status: 500, headers });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  const headers = corsHeaders(req.headers.get('origin'));
  try {
    const { slug, id } = await params;
    const db = getDb();
    const [row] = await db
      .select()
      .from(tags)
      .where(and(eq(tags.id, id), eq(tags.replaySlug, slug)))
      .limit(1);
    if (!row) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404, headers });
    if (!(await canDelete(row, slug, req))) {
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403, headers });
    }
    await db.delete(tags).where(eq(tags.id, id));
    return NextResponse.json({ ok: true }, { headers });
  } catch (err: any) {
    console.error('[karabuddy] DELETE tag failed:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'internal error' }, { status: 500, headers });
  }
}
