import { NextResponse } from 'next/server';
import { eq, inArray } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { replays } from '@/lib/schema';
import { getMyTeamSlugs, surfacedReplaySlugs } from '@/lib/teamSurface';

export const runtime = 'nodejs';

// GET /api/me/labels — distinct label suggestions for the signed-in
// user. Aggregates labels from:
//   1. The user's own replays
//   2. Replays surfaced (via lib/teamSurface) to any team they belong to
//
// Used by the in-viewer label picker so users can re-tag with the same
// labels they (or their teammates) have already used.
export async function GET() {
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  }

  const db = getDb();
  const myTeamSlugs = await getMyTeamSlugs(userId);
  const teamReplaySlugs = await surfacedReplaySlugs(myTeamSlugs);

  // User's own replays — separate signal from team surfacing because the
  // user may have private replays no team can see.
  const myReplays = await db
    .select({ labels: replays.labels })
    .from(replays)
    .where(eq(replays.userId, userId));

  const teamReplays = teamReplaySlugs.length > 0
    ? await db
        .select({ labels: replays.labels })
        .from(replays)
        .where(inArray(replays.slug, teamReplaySlugs))
    : [];

  const all = new Set<string>();
  for (const r of [...myReplays, ...teamReplays]) {
    if (Array.isArray(r.labels)) for (const l of r.labels) {
      if (typeof l === 'string' && l.trim()) all.add(l);
    }
  }

  return NextResponse.json({
    ok: true,
    labels: Array.from(all).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
  });
}
