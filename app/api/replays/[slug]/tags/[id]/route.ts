import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { replays, tags } from '@/lib/schema';
import { corsHeaders, preflight } from '@/lib/cors';
import { auth } from '@/auth';
import { sanitizeIncomingMentions } from '@/lib/mentions';
import { authContextFromRequest, canDeleteTag, canEditTag } from '@/lib/replayPermissions';

// Predicates live in lib/replayPermissions — these wrappers just
// resolve the session (server-only) and look up the parent replay for
// the delete check.
async function canEdit(row: { userId: string | null; authorToken: string }, req: Request): Promise<boolean> {
  const session = await auth();
  const sessionUserId: string | null = (session?.user as any)?.id || null;
  return canEditTag(row, authContextFromRequest(req, sessionUserId));
}

async function canDelete(
  row: { userId: string | null; authorToken: string },
  slug: string,
  req: Request,
): Promise<boolean> {
  const session = await auth();
  const sessionUserId: string | null = (session?.user as any)?.id || null;
  const ctx = authContextFromRequest(req, sessionUserId);
  if (canEditTag(row, ctx)) return true;
  const db = getDb();
  const [replay] = await db
    .select({ userId: replays.userId, ownerToken: replays.ownerToken })
    .from(replays)
    .where(eq(replays.slug, slug))
    .limit(1);
  if (!replay) return false;
  return canDeleteTag(row, replay, ctx);
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
    // B55c: mentions are optional on PATCH. If absent, leave existing
    // mentions in place (the user may have edited just the text). If
    // present (even empty), accept the client's structure as authoritative.
    const updates: Record<string, unknown> = { comment };
    if (body.mentions !== undefined) {
      const m = sanitizeIncomingMentions(body.mentions);
      updates.mentions = m.userIds.length || m.teamSlugs.length ? m : null;
    }
    await db.update(tags).set(updates).where(eq(tags.id, id));
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
