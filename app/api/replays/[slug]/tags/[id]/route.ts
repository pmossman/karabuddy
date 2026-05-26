import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { tags } from '@/lib/schema';
import { corsHeaders, preflight } from '@/lib/cors';
import { auth } from '@/auth';

// Tag is editable/deletable by either:
//   - the signed-in user whose userId matches the tag's userId
//   - the holder of the original install token (anonymous-author case)
async function canMutate(row: { userId: string | null; authorToken: string }, req: Request): Promise<boolean> {
  const session = await auth();
  const sessionUserId: string | null = (session?.user as any)?.id || null;
  if (sessionUserId && row.userId === sessionUserId) return true;
  const headerToken = req.headers.get('x-install-token');
  if (headerToken && row.authorToken === headerToken) return true;
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
    if (!(await canMutate(row, req))) {
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
    if (!(await canMutate(row, req))) {
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403, headers });
    }
    await db.delete(tags).where(eq(tags.id, id));
    return NextResponse.json({ ok: true }, { headers });
  } catch (err: any) {
    console.error('[karabuddy] DELETE tag failed:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'internal error' }, { status: 500, headers });
  }
}
