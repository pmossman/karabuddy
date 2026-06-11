import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { tournaments, tournamentEntrants, teamMembers } from '@/lib/schema';
import { getTeamMembership } from '@/lib/teamSurface';

export const runtime = 'nodejs';

// POST /api/tournaments/invite/[code]/join — signed-in entrant (registered via
// the invite link while signed in, so already account-linked) joins the team.
// Requires HAVING a linked entrant in this tournament — the invite admits
// players, not bystanders.
export async function POST(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });

  const db = getDb();
  const [t] = await db.select().from(tournaments).where(eq(tournaments.inviteCode, code)).limit(1);
  if (!t) return NextResponse.json({ ok: false, error: 'invite not found' }, { status: 404 });

  const [entrant] = await db
    .select({ id: tournamentEntrants.id })
    .from(tournamentEntrants)
    .where(and(eq(tournamentEntrants.tournamentId, t.id), eq(tournamentEntrants.userId, userId)))
    .limit(1);
  if (!entrant) {
    return NextResponse.json({ ok: false, error: 'register for the tournament first' }, { status: 403 });
  }

  if (!(await getTeamMembership(t.teamSlug, userId))) {
    await db.insert(teamMembers).values({ teamSlug: t.teamSlug, userId, role: 'member' }).onConflictDoNothing();
  }
  return NextResponse.json({ ok: true, teamSlug: t.teamSlug, tournamentId: t.id });
}
