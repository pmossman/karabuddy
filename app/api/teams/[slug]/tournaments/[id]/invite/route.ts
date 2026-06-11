import { NextResponse } from 'next/server';
import { eq, and, isNull } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { tournaments } from '@/lib/schema';
import { getTeamMembership } from '@/lib/teamSurface';
import { loadTournament, isOrganizer } from '@/lib/tournamentAccess';
import { generateInviteCode } from '@/lib/slug';

export const runtime = 'nodejs';

// POST /api/teams/[slug]/tournaments/[id]/invite — organizer; get-or-create the
// tournament's public invite code. The link (/tournaments/join?code=...) lets
// anyone view the registration page and self-register as a GUEST while the
// tournament is in setup (B126).
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  const me = await getTeamMembership(slug, userId);
  if (!me) return NextResponse.json({ ok: false, error: 'not a member' }, { status: 403 });
  const t = await loadTournament(slug, id);
  if (!t) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  if (!isOrganizer(t, userId, me.role)) {
    return NextResponse.json({ ok: false, error: 'organizer only' }, { status: 403 });
  }

  if (t.inviteCode) return NextResponse.json({ ok: true, code: t.inviteCode });

  // Mint lazily; the WHERE invite_code IS NULL guard makes a concurrent
  // double-mint a no-op race (one writes, the re-read returns the winner).
  const code = generateInviteCode();
  await getDb()
    .update(tournaments)
    .set({ inviteCode: code })
    .where(and(eq(tournaments.id, id), isNull(tournaments.inviteCode)));
  const fresh = await loadTournament(slug, id);
  return NextResponse.json({ ok: true, code: fresh?.inviteCode ?? code });
}
