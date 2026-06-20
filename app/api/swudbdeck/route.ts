import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { importDeck } from '@/lib/deckImport';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// B124: deck-site import proxy — un-deads the lifted app/_utils/fetchDeckData
// (its client preview calls exactly this path/shape, matching karabast's
// upstream route). Unlike karabast's, this one is SESSION-REQUIRED: it's an
// outbound-fetch relay, and we don't run an open one.
//
// Response mirrors karabast's IDeckData shape so fetchDeckData's error
// handling (incl. the 403 private-deck branch) works unchanged.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'sign in required' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const deckLink = searchParams.get('deckLink');
  if (!deckLink) {
    return NextResponse.json({ error: 'Missing deckLink' }, { status: 400 });
  }

  const result = await importDeck(deckLink);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    metadata: { name: result.deckName ?? '' },
    leader: result.deck.leader,
    secondleader: result.deck.secondleader ?? null,
    base: result.deck.base,
    deck: result.deck.deck,
    sideboard: result.deck.sideboard,
    deckSource: result.deckSource,
    deckID: result.deckId,
    deckLink,
  });
}
