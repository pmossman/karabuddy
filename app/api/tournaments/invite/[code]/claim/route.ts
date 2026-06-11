import { NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { tournaments, tournamentEntrants, teamMembers, users } from '@/lib/schema';
import { getTeamMembership } from '@/lib/teamSurface';

export const runtime = 'nodejs';

// POST /api/tournaments/invite/[code]/claim — signed-in; body { claimToken }.
// The guest→member upgrade (B126): a guest entrant created via the invite link
// (or by the organizer) claims their entry with the per-entrant secret. The
// claim links the entrant to the account (userId + account display name),
// AND joins them to the team as a member — the tournament invite was the
// organizer's deliberate "come play with us", so it admits to the team the
// tournament lives in. Works during setup AND active (linking identity
// mid-tournament unlocks replay suggestions + self-reporting).
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });

  const db = getDb();
  const [t] = await db.select().from(tournaments).where(eq(tournaments.inviteCode, code)).limit(1);
  if (!t) return NextResponse.json({ ok: false, error: 'invite not found' }, { status: 404 });
  if (t.status === 'complete') {
    return NextResponse.json({ ok: false, error: 'tournament is finished' }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const claimToken = String(body.claimToken || '').trim();
  if (!claimToken) return NextResponse.json({ ok: false, error: 'claimToken required' }, { status: 400 });

  // The token must match a still-unclaimed GUEST entrant of THIS tournament.
  const [entrant] = await db
    .select()
    .from(tournamentEntrants)
    .where(and(
      eq(tournamentEntrants.tournamentId, t.id),
      eq(tournamentEntrants.claimToken, claimToken),
      isNull(tournamentEntrants.userId),
    ))
    .limit(1);
  if (!entrant) return NextResponse.json({ ok: false, error: 'claim link is invalid or already used' }, { status: 404 });

  // One entry per account: if this user already has an entrant here, refuse
  // (the organizer can delete the duplicate guest instead).
  const [dup] = await db
    .select({ id: tournamentEntrants.id })
    .from(tournamentEntrants)
    .where(and(eq(tournamentEntrants.tournamentId, t.id), eq(tournamentEntrants.userId, userId)))
    .limit(1);
  if (dup) {
    return NextResponse.json({ ok: false, error: "you already have a registration in this tournament — ask the organizer to remove the guest entry" }, { status: 409 });
  }

  const [u] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  const accountName = (u?.name || u?.email || entrant.displayName).slice(0, 80);

  // Link the entrant to the account. claimToken is single-use.
  await db
    .update(tournamentEntrants)
    .set({ userId, displayName: accountName, claimToken: null })
    .where(eq(tournamentEntrants.id, entrant.id));

  // Join the team (idempotent — already-member is a no-op).
  const alreadyMember = await getTeamMembership(t.teamSlug, userId);
  if (!alreadyMember) {
    await db.insert(teamMembers).values({ teamSlug: t.teamSlug, userId, role: 'member' }).onConflictDoNothing();
  }

  return NextResponse.json({ ok: true, teamSlug: t.teamSlug, tournamentId: t.id, joinedTeam: !alreadyMember });
}
