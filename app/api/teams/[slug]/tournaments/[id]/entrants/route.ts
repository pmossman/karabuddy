import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { tournamentEntrants, users } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { getTeamMembership } from '@/lib/teamSurface';
import { loadTournament, isOrganizer } from '@/lib/tournamentAccess';
import { importDeck } from '@/lib/deckImport';
import { generateSlug } from '@/lib/slug';
import { notifyEntrantRegistered } from '@/lib/tournamentNotify';

export const runtime = 'nodejs';

// POST /api/teams/[slug]/tournaments/[id]/entrants
//
// Two shapes, branched on `displayName`:
//   - SELF-REGISTER (any member, while status=setup): { deckLink? }
//   - GUEST-ADD (organizer only, while setup):        { displayName, deckLink? }
//     Guests aren't karabuddy users — the organizer names them and manages
//     their deck + results manually.
//
// A deckLink is imported + snapshotted server-side; an import FAILURE returns
// the error but never blocks plain registration — the caller retries the deck
// via PATCH later. (We fail the request when a link was given and is broken,
// rather than silently registering without the deck the user thought they
// submitted.)
export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  const me = await getTeamMembership(slug, userId);
  if (!me) return NextResponse.json({ ok: false, error: 'not a member' }, { status: 403 });
  const t = await loadTournament(slug, id);
  if (!t) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  if (t.status !== 'setup') {
    return NextResponse.json({ ok: false, error: 'registration is closed once the tournament starts' }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const isGuestAdd = body.displayName !== undefined;

  let entrantUserId: string | null;
  let displayName: string;
  if (isGuestAdd) {
    if (!isOrganizer(t, userId, me.role)) {
      return NextResponse.json({ ok: false, error: 'organizer only' }, { status: 403 });
    }
    displayName = String(body.displayName || '').trim().slice(0, 80);
    if (!displayName) return NextResponse.json({ ok: false, error: 'displayName required' }, { status: 400 });
    entrantUserId = null; // guest
  } else {
    entrantUserId = userId;
    const [u] = await getDb().select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    displayName = (u?.name || u?.email || 'Member').slice(0, 80);
  }

  // Optional decklist import (shared by both shapes).
  let deckFields: { deckLink: string; deckName: string | null; deck: import('@/lib/schema').TournamentDeck } | null = null;
  if (body.deckLink) {
    const result = await importDeck(String(body.deckLink));
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    deckFields = { deckLink: String(body.deckLink).trim(), deckName: result.deckName, deck: result.deck };
  }

  const entrantId = generateSlug('te_', 8);
  try {
    await getDb().insert(tournamentEntrants).values({
      id: entrantId,
      tournamentId: id,
      userId: entrantUserId,
      displayName,
      // B126: guests get a claim secret so they can later link an account
      // (the organizer can hand them their personal claim link).
      claimToken: entrantUserId === null ? generateSlug('tc_', 14) : null,
      ...(deckFields ?? {}),
    });
  } catch (err: any) {
    // Partial unique index: one registration per ACCOUNT per tournament.
    // Drizzle wraps the driver error (the pg fields live on `cause`), and
    // drivers differ in where they put the constraint — walk the chain.
    for (let e = err; e; e = e.cause) {
      if (e?.code === '23505' || String(e?.constraint || e?.message || '').includes('tournament_entrants_tournament_user_idx')) {
        return NextResponse.json({ ok: false, error: 'already registered' }, { status: 409 });
      }
    }
    throw err;
  }
  // B144: best-effort Discord post — never blocks the write.
  try { await notifyEntrantRegistered(slug, id, displayName); } catch (e) { console.error('[karabuddy] notifyEntrantRegistered failed:', e); }
  return NextResponse.json({ ok: true, entrantId });
}
