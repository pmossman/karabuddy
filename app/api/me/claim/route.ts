import { NextResponse } from 'next/server';
import { eq, and, sql } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { extensionTokens, replays, tags } from '@/lib/schema';

// POST /api/me/claim  { token: string }
//
// Two effects in one call:
//   1. Insert/update the (token, userId) mapping in extension_tokens so
//      FUTURE uploads from this install attribute to the signed-in user.
//   2. Backfill userId on any existing replays + tags whose ownerToken /
//      authorToken equals this token — so the user's existing extension
//      history rolls into their account.
//
// Idempotent: re-running with the same token is a no-op for already-
// claimed rows.
export async function POST(req: Request) {
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const token: string = String(body.token || '').trim();
  if (!token) {
    return NextResponse.json({ ok: false, error: 'token required' }, { status: 400 });
  }

  const db = getDb();
  await db
    .insert(extensionTokens)
    .values({ token, userId })
    .onConflictDoUpdate({ target: extensionTokens.token, set: { userId } });

  const replayResult = await db
    .update(replays)
    .set({ userId })
    .where(and(eq(replays.ownerToken, token), sql`${replays.userId} IS NULL`))
    .returning({ slug: replays.slug });

  const tagResult = await db
    .update(tags)
    .set({ userId })
    .where(and(eq(tags.authorToken, token), sql`${tags.userId} IS NULL`))
    .returning({ id: tags.id });

  return NextResponse.json({
    ok: true,
    claimedReplays: replayResult.length,
    claimedTags: tagResult.length,
  });
}
