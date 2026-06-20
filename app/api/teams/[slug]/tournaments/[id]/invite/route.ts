import { NextResponse } from 'next/server';
import { eq, and, isNull } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { tournaments } from '@/lib/schema';
import { loadTournament, requireOrganizer } from '@/lib/tournamentAccess';
import { generateInviteCode } from '@/lib/slug';

export const runtime = 'nodejs';

// POST /api/teams/[slug]/tournaments/[id]/invite — organizer; get-or-create the
// tournament's public invite code. The link (/tournaments/join?code=...) lets
// anyone view the registration page and self-register as a GUEST while the
// tournament is in setup (B126).
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const gate = await requireOrganizer(slug, id);
  if (gate instanceof NextResponse) return gate;
  const t = gate.access.tournament;

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
