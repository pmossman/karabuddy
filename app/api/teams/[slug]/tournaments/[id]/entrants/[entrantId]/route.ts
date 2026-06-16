import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { tournamentEntrants } from '@/lib/schema';
import { getTournamentAccess, loadEntrant } from '@/lib/tournamentAccess';
import { importDeck } from '@/lib/deckImport';
import { validateDeckServer } from '@/lib/deckLegalityServer';
import { notifyEntrantRegistered } from '@/lib/tournamentNotify';

export const runtime = 'nodejs';

// PATCH /api/teams/[slug]/tournaments/[id]/entrants/[entrantId]
//   { deckLink }        — (re)import + snapshot the decklist. Self while the
//                         tournament is in setup; organizer anytime (covers
//                         guests + post-start fixes).
//   { resync: true }    — re-import the ALREADY-STORED deckLink (no re-paste).
//                         The snapshot is point-in-time, so editing the deck on
//                         swudb (e.g. to fix an illegal list) doesn't propagate
//                         until it's re-pulled. Same authz as { deckLink }.
//   { displayName }     — rename. Organizer-only, guests only (a linked
//                         member's name tracks their account).
//   { dropped: bool }   — drop / undrop. Organizer anytime; a linked entrant
//                         can drop THEMSELVES while the tournament is active.
export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string; id: string; entrantId: string }> }) {
  const { slug, id, entrantId } = await params;
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  // B127: member OR linked entrant (invite-link players manage their own entry).
  const access = await getTournamentAccess(slug, id, userId);
  if (!access) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  if (!access.canView) return NextResponse.json({ ok: false, error: 'not a member or entrant' }, { status: 403 });
  const t = access.tournament;
  const entrant = await loadEntrant(id, entrantId);
  if (!entrant) return NextResponse.json({ ok: false, error: 'entrant not found' }, { status: 404 });

  const organizer = access.organizer;
  const isSelf = !!entrant.userId && entrant.userId === userId;
  const body = await req.json().catch(() => ({}));
  const update: Record<string, unknown> = {};
  // B151: captured to fire a "deck updated" Discord post after the write.
  let deckChange: { deckName: string | null; leaderId: string | null; baseId: string | null } | null = null;

  const resync = body.resync === true && body.deckLink === undefined;
  if (body.deckLink !== undefined || resync) {
    const allowed = organizer || (isSelf && t.status === 'setup');
    if (!allowed) {
      return NextResponse.json(
        { ok: false, error: t.status === 'setup' ? 'not your registration' : 'decklists are locked once the tournament starts' },
        { status: 403 }
      );
    }
    // resync re-pulls the stored link (the snapshot is point-in-time, so a
    // swudb edit won't show until it's re-imported); otherwise use the new link.
    const link = resync ? String(entrant.deckLink || '').trim() : String(body.deckLink || '').trim();
    if (resync && !link) {
      return NextResponse.json({ ok: false, error: 'no saved deck link to re-sync' }, { status: 400 });
    }
    const result = await importDeck(link);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    const legality = await validateDeckServer(result.deck);
    if (!legality.legal) {
      return NextResponse.json({ ok: false, error: `Decklist isn't legal: ${legality.violations.map((v) => v.message).join('; ')}`, violations: legality.violations }, { status: 400 });
    }
    update.deckLink = link;
    update.deckName = result.deckName;
    update.deck = result.deck;
    deckChange = { deckName: result.deckName, leaderId: result.deck.leader?.id ?? null, baseId: result.deck.base?.id ?? null };
  }

  if (body.displayName !== undefined) {
    if (!organizer) return NextResponse.json({ ok: false, error: 'organizer only' }, { status: 403 });
    if (entrant.userId) {
      return NextResponse.json({ ok: false, error: 'linked entrants are named by their account' }, { status: 400 });
    }
    const name = String(body.displayName || '').trim().slice(0, 80);
    if (!name) return NextResponse.json({ ok: false, error: 'displayName required' }, { status: 400 });
    update.displayName = name;
  }

  if (body.dropped !== undefined) {
    const dropped = !!body.dropped;
    // Organizer: anytime. Self: drop only (no self-undrop) while active.
    const allowed = organizer || (isSelf && dropped && t.status === 'active');
    if (!allowed) return NextResponse.json({ ok: false, error: 'organizer only' }, { status: 403 });
    update.dropped = dropped;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: false, error: 'nothing to update' }, { status: 400 });
  }
  await getDb().update(tournamentEntrants).set(update).where(eq(tournamentEntrants.id, entrantId));

  // B151: best-effort Discord post when the decklist changed — never blocks.
  if (deckChange) {
    try {
      await notifyEntrantRegistered(slug, id, {
        entrantName: (update.displayName as string) || entrant.displayName,
        deckName: deckChange.deckName,
        leaderId: deckChange.leaderId,
        baseId: deckChange.baseId,
        updated: true,
      });
    } catch (e) { console.error('[karabuddy] deck-update notify failed:', e); }
  }

  return NextResponse.json({ ok: true });
}

// DELETE — unregister, SETUP ONLY (self or organizer). Once the tournament
// has started an entrant is part of the pairing history: drop, never delete.
export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string; id: string; entrantId: string }> }) {
  const { slug, id, entrantId } = await params;
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  const access = await getTournamentAccess(slug, id, userId);
  if (!access) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  if (!access.canView) return NextResponse.json({ ok: false, error: 'not a member or entrant' }, { status: 403 });
  const t = access.tournament;
  const entrant = await loadEntrant(id, entrantId);
  if (!entrant) return NextResponse.json({ ok: false, error: 'entrant not found' }, { status: 404 });

  if (t.status !== 'setup') {
    return NextResponse.json({ ok: false, error: 'tournament started — drop instead of unregistering' }, { status: 409 });
  }
  const organizer = access.organizer;
  const isSelf = !!entrant.userId && entrant.userId === userId;
  if (!organizer && !isSelf) {
    return NextResponse.json({ ok: false, error: 'not your registration' }, { status: 403 });
  }
  await getDb().delete(tournamentEntrants).where(eq(tournamentEntrants.id, entrantId));
  return NextResponse.json({ ok: true });
}
