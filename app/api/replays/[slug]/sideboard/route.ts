import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { sideboardResponses, users } from '@/lib/schema';
import { requireSession } from '@/lib/apiAuth';
import { cardRefs, type OpeningCardRef } from '@/lib/openingDrills';
import { sideboardEntitlement, visibleSideboardResponses } from '@/lib/sideboardDrills';
import { multisetContains } from '@/lib/multiset';

export const runtime = 'nodejs';

// B227: one sideboard drill — the game-N deck + sideboard (the pool the swap
// chose from), the matchup, and (once answered/owned) the reveal: the recorder's
// actual swap + the team's answers. Entitled = replay owner or a member of a
// team it's shared to.

type SideCard = { id: string; count: number; cost?: number | null };
interface SideCardRef extends OpeningCardRef { count: number }

const expand = (cards: SideCard[]): string[] => cards.flatMap((c) => Array(Math.max(1, c.count)).fill(c.id));

async function buildDetail(replay: any, side: any, viewerId: string, isOwner: boolean) {
  const db = getDb();
  const deckCards = (side.deck as SideCard[]) ?? [];
  const sideCards = (side.sideboard as SideCard[]) ?? [];
  const refs = await cardRefs([...deckCards.map((c) => c.id), ...sideCards.map((c) => c.id), ...(side.swappedIn as string[]), ...(side.swappedOut as string[])]);
  const withCount = (cards: SideCard[]): SideCardRef[] => cards.map((c) => ({ ...refs.get(c.id)!, count: c.count }));

  const players = Array.isArray(replay.players) ? (replay.players as any[]) : [];
  const own = players.find((p: any) => p?.id === side.recorderId) ?? null;
  const opp = players.find((p: any) => p?.id !== side.recorderId) ?? null;

  const [mineRow] = await db.select().from(sideboardResponses).where(eq(sideboardResponses.replaySlug, replay.slug)).then((rows) => rows.filter((r) => r.userId === viewerId));
  const answered = !!mineRow;

  const detail: any = {
    replaySlug: replay.slug,
    previousSlug: side.previousSlug,
    playedAt: replay.createdAt instanceof Date ? replay.createdAt.toISOString() : (replay.createdAt ?? null),
    gameNumber: side.gameNumber,
    wonPrevious: side.wonPrevious,
    ownLeader: own?.leader ?? null,
    ownBase: own?.base ?? null,
    oppLeader: opp?.leader ?? null,
    oppBase: opp?.base ?? null,
    deck: withCount(deckCards),
    sideboard: withCount(sideCards),
    isOwner,
    answered,
    myResponse: mineRow ? { swappedIn: mineRow.swappedIn, swappedOut: mineRow.swappedOut } : null,
  };

  if (answered || isOwner) {
    let recorderName: string | null = null;
    if (replay.userId) {
      const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, replay.userId));
      recorderName = u?.name ?? null;
    }
    detail.reveal = {
      recorder: { userId: replay.userId ?? null, name: recorderName },
      swappedIn: (side.swappedIn as string[]) ?? [],
      swappedOut: (side.swappedOut as string[]) ?? [],
      responses: await visibleSideboardResponses(replay.slug, viewerId, { isOwner }),
    };
  }
  return detail;
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = await requireSession();
  if (s instanceof NextResponse) return s;
  const ent = await sideboardEntitlement(slug, s.userId);
  if (!ent) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true, data: await buildDetail(ent.replay, ent.side, s.userId, ent.isOwner) });
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = await requireSession();
  if (s instanceof NextResponse) return s;
  const ent = await sideboardEntitlement(slug, s.userId);
  if (!ent) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  if (ent.isOwner) return NextResponse.json({ ok: false, error: 'own sideboard' }, { status: 403 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 }); }
  const swappedIn = body?.swappedIn;
  const swappedOut = body?.swappedOut;
  const okArr = (a: unknown) => Array.isArray(a) && a.every((x) => typeof x === 'string');
  if (!okArr(swappedIn) || !okArr(swappedOut)) {
    return NextResponse.json({ ok: false, error: 'swappedIn/swappedOut must be cardId arrays' }, { status: 400 });
  }
  // Bring-ins must come from the game-N sideboard; cuts from the game-N deck.
  const deckPool = expand((ent.side.deck as SideCard[]) ?? []);
  const sidePool = expand((ent.side.sideboard as SideCard[]) ?? []);
  if (!multisetContains(sidePool, swappedIn)) return NextResponse.json({ ok: false, error: 'a brought-in card is not in the sideboard' }, { status: 400 });
  if (!multisetContains(deckPool, swappedOut)) return NextResponse.json({ ok: false, error: 'a cut card is not in the deck' }, { status: 400 });

  // Immutable: first answer counts.
  await getDb()
    .insert(sideboardResponses)
    .values({ replaySlug: slug, userId: s.userId, swappedIn: [...swappedIn].sort(), swappedOut: [...swappedOut].sort() })
    .onConflictDoNothing();

  return NextResponse.json({ ok: true, data: await buildDetail(ent.replay, ent.side, s.userId, ent.isOwner) });
}
