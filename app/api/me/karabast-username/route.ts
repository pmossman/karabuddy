import { NextResponse } from 'next/server';
import { eq, and, ne } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { users, replays, tags } from '@/lib/schema';
import { auth } from '@/auth';

// POST /api/me/karabast-username  { username: string | null }
//
// Claim (or clear) the user's karabast.net display name. On set, also
// backfill any prior anonymous uploads + tags whose stored author matches
// this username — so the user retroactively owns their extension-recorded
// history. Until karabast exposes OAuth, this is the bridge: trust the
// user's claim, with the understanding that anyone with a similar enough
// karabast handle could in theory claim it. (Phase 2 replaces this with a
// verified OAuth flow.)
export async function POST(req: Request) {
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const raw = typeof body.username === 'string' ? body.username.trim() : null;
  const username = raw && raw.length > 0 ? raw : null;

  const db = getDb();
  await db.update(users).set({ karabastUsername: username }).where(eq(users.id, userId));

  let claimedReplays = 0;
  let claimedTags = 0;
  if (username) {
    // Backfill anonymous replays whose players[].username matches. SQL-side
    // jsonb predicate is awkward in drizzle; do a scan + filter in JS.
    // (Volume is small — single user's matching anonymous uploads.)
    const anonReplays = await db
      .select()
      .from(replays)
      .where(and(eq(replays.userId, null as any), ne(replays.ownerToken, '')));
    const matchSlugs: string[] = [];
    for (const row of anonReplays) {
      const players = (row.players as any[]) || [];
      if (players.some((p) => p?.username === username)) matchSlugs.push(row.slug);
    }
    for (const slug of matchSlugs) {
      await db.update(replays).set({ userId }).where(eq(replays.slug, slug));
      claimedReplays++;
    }

    // Tags authored under this name without a userId.
    const orphanTags = await db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.userId, null as any), eq(tags.authorName, username)));
    for (const t of orphanTags) {
      await db.update(tags).set({ userId }).where(eq(tags.id, t.id));
      claimedTags++;
    }
  }

  return NextResponse.json({ ok: true, claimedReplays, claimedTags });
}
