import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { replayViews } from '@/lib/schema';

export const runtime = 'nodejs';

// POST /api/replays/[slug]/viewed — B149/ADR 0009: stamp the signed-in viewer's
// "I looked at this replay" time and return the PREVIOUS one, so the review panel
// can mark tags created since the last visit as new. No-op for signed-out viewers
// (no per-user last-viewed to track).
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  const userId: string | null = session?.user?.id || null;
  if (!userId) return NextResponse.json({ ok: true, previousViewedAt: null });

  const db = getDb();
  const [existing] = await db
    .select({ viewedAt: replayViews.viewedAt })
    .from(replayViews)
    .where(and(eq(replayViews.replaySlug, slug), eq(replayViews.userId, userId)))
    .limit(1);
  const previousViewedAt = existing?.viewedAt?.toISOString() ?? null;

  await db
    .insert(replayViews)
    .values({ replaySlug: slug, userId })
    .onConflictDoUpdate({ target: [replayViews.replaySlug, replayViews.userId], set: { viewedAt: new Date() } });

  return NextResponse.json({ ok: true, previousViewedAt });
}
