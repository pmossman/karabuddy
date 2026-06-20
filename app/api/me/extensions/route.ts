import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { extensionTokens } from '@/lib/schema';

export const runtime = 'nodejs';

// GET /api/me/extensions — list the user's linked extension installs.
// Each row is one browser/profile where they've claimed the install
// token. Used by the Settings page's Linked Extensions section so users
// can see which browsers are linked + revoke ones they don't recognize.
//
// Returns the FULL token string. It's already the caller's data — they
// own these tokens — and copying it out (e.g. to revoke from another
// device) requires it. UI displays only the leading prefix unless the
// user expands.
//
// Session-required (NOT install-token-fallback) — listing linked
// extensions while authenticated only via an install token would be
// circular. Sign in via the web to manage them.
export async function GET() {
  const session = await auth();
  const userId: string | null = session?.user?.id || null;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  }
  const db = getDb();
  const rows = await db
    .select({ token: extensionTokens.token, linkedAt: extensionTokens.linkedAt })
    .from(extensionTokens)
    .where(eq(extensionTokens.userId, userId))
    .orderBy(desc(extensionTokens.linkedAt));
  return NextResponse.json({
    ok: true,
    extensions: rows.map((r) => ({
      token: r.token,
      linkedAt: r.linkedAt.toISOString(),
    })),
  });
}

// DELETE /api/me/extensions  { token: string }
// Revoke a single extension link. After revoke, replays uploaded with
// that install token attribute to the token itself (anonymous), not the
// user — same state as before the original /claim. Existing replays
// already attributed via userId stay attributed.
//
// Owner-only: can only revoke a row whose userId matches the session.
export async function DELETE(req: Request) {
  const session = await auth();
  const userId: string | null = session?.user?.id || null;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const token: string = String(body.token || '').trim();
  if (!token) {
    return NextResponse.json({ ok: false, error: 'token required' }, { status: 400 });
  }
  const db = getDb();
  const result = await db
    .delete(extensionTokens)
    .where(and(eq(extensionTokens.token, token), eq(extensionTokens.userId, userId)))
    .returning({ token: extensionTokens.token });
  if (result.length === 0) {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
