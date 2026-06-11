import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { tournaments, tournamentEntrants, teams } from '@/lib/schema';
import { getTeamMembership } from '@/lib/teamSurface';

export const runtime = 'nodejs';

// GET /api/tournaments/invite/[code] — PUBLIC (the code is the capability).
// Powers the /tournaments/join registration page: tournament + team names,
// status, entrant display names (never decks/links — this page is outside the
// team), and the signed-in viewer's relationship to it.
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const db = getDb();
  const [t] = await db.select().from(tournaments).where(eq(tournaments.inviteCode, code)).limit(1);
  if (!t) return NextResponse.json({ ok: false, error: 'invite not found' }, { status: 404 });

  const [[team], entrants] = await Promise.all([
    db.select({ name: teams.name, slug: teams.slug }).from(teams).where(eq(teams.slug, t.teamSlug)).limit(1),
    db.select().from(tournamentEntrants).where(eq(tournamentEntrants.tournamentId, t.id)),
  ]);

  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  const isMember = userId ? !!(await getTeamMembership(t.teamSlug, userId)) : false;
  const myEntrant = userId ? entrants.find((e) => e.userId === userId) ?? null : null;

  return NextResponse.json({
    ok: true,
    data: {
      tournament: { id: t.id, name: t.name, status: t.status },
      team: { slug: team?.slug ?? t.teamSlug, name: team?.name ?? t.teamSlug },
      entrants: entrants.map((e) => ({ displayName: e.displayName, isGuest: !e.userId, dropped: e.dropped })),
      registrationOpen: t.status === 'setup',
      viewer: {
        signedIn: !!userId,
        isMember,
        registered: !!myEntrant,
      },
    },
  });
}
