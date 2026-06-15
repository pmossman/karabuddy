import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { tournaments, tournamentEntrants, users } from '@/lib/schema';
import { getTeamMembership } from '@/lib/teamSurface';
import { importDeck } from '@/lib/deckImport';
import { generateSlug } from '@/lib/slug';
import { notifyEntrantRegistered } from '@/lib/tournamentNotify';
import type { TournamentDeck } from '@/lib/schema';

export const runtime = 'nodejs';

// POST /api/tournaments/invite/[code]/register — PUBLIC self-registration via
// the invite link (B126). body: { displayName?, deckLink? }
//
//   • signed OUT → GUEST entrant (userId null) + a claimToken returned to the
//     browser so creating an account later can claim the entry.
//   • signed IN, not a team member → LINKED entrant (userId set, named from
//     the account) — replay suggestions work; reporting/viewing still needs
//     team membership (they can claim a team spot via the join flow).
//   • signed IN team member → 409: register on the tournament page instead
//     (keeps one canonical member flow).
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const db = getDb();
  const [t] = await db.select().from(tournaments).where(eq(tournaments.inviteCode, code)).limit(1);
  if (!t) return NextResponse.json({ ok: false, error: 'invite not found' }, { status: 404 });
  if (t.status !== 'setup') {
    return NextResponse.json({ ok: false, error: 'registration is closed — the tournament has started' }, { status: 409 });
  }

  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  const body = await req.json().catch(() => ({}));

  let displayName: string;
  if (userId) {
    if (await getTeamMembership(t.teamSlug, userId)) {
      return NextResponse.json({ ok: false, error: "you're a team member — register on the tournament page" }, { status: 409 });
    }
    const [u] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    displayName = (String(body.displayName || '').trim() || u?.name || u?.email || 'Player').slice(0, 80);
  } else {
    displayName = String(body.displayName || '').trim().slice(0, 80);
    if (!displayName) return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 });
  }

  // Reject duplicate display names (case-insensitive) — a public form needs a
  // cheap idiot-proofing layer, and the organizer can't tell two "Mike"s apart.
  const existing = await db
    .select({ id: tournamentEntrants.id, displayName: tournamentEntrants.displayName })
    .from(tournamentEntrants)
    .where(eq(tournamentEntrants.tournamentId, t.id));
  if (existing.some((e) => e.displayName.toLowerCase() === displayName.toLowerCase())) {
    return NextResponse.json({ ok: false, error: 'that name is already registered — pick another (or ask the organizer)' }, { status: 409 });
  }

  let deckFields: { deckLink: string; deckName: string | null; deck: TournamentDeck } | null = null;
  if (body.deckLink) {
    const result = await importDeck(String(body.deckLink));
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    deckFields = { deckLink: String(body.deckLink).trim(), deckName: result.deckName, deck: result.deck };
  }

  const entrantId = generateSlug('te_', 8);
  const claimToken = userId ? null : generateSlug('tc_', 14);
  try {
    await db.insert(tournamentEntrants).values({
      id: entrantId,
      tournamentId: t.id,
      userId,
      displayName,
      claimToken,
      ...(deckFields ?? {}),
    });
  } catch (err: any) {
    for (let e = err; e; e = e.cause) {
      if (e?.code === '23505' || String(e?.constraint || e?.message || '').includes('tournament_entrants_tournament_user_idx')) {
        return NextResponse.json({ ok: false, error: 'already registered' }, { status: 409 });
      }
    }
    throw err;
  }
  // B144/B151: best-effort Discord post (with deck name + leader/base) — never blocks the write.
  try {
    await notifyEntrantRegistered(t.teamSlug, t.id, {
      entrantName: displayName,
      deckName: deckFields?.deckName ?? null,
      leaderId: deckFields?.deck.leader?.id ?? null,
      baseId: deckFields?.deck.base?.id ?? null,
    });
  } catch (e) { console.error('[karabuddy] notifyEntrantRegistered failed:', e); }
  // claimToken goes back to the registering browser ONLY — it's their secret.
  return NextResponse.json({ ok: true, entrantId, claimToken });
}
