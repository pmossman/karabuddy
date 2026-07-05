import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { openingResponses, users } from '@/lib/schema';
import { requireSession } from '@/lib/apiAuth';
import {
  cardRefs,
  openingEntitlement,
  visibleResponses,
  type OpeningCardRef,
} from '@/lib/openingDrills';

export const runtime = 'nodejs';

// B221: one opening-drill item.
//   GET  — the quiz payload: matchup context + the dealt hand (stage 1) + the
//          kept hand (stage 2), catalog-enriched. The ANSWERS (recorded
//          decision, resourced pair, recorder identity, team distribution)
//          are serialized only for viewers who answered or own the replay.
//   POST — submit {decision, resourced[2]}. Immutable: first answer counts;
//          a re-POST returns the stored answer untouched. Owners can't answer
//          their own opening. Returns the reveal payload.
// Auth: session + entitlement (owner, or member of a team the replay is
// shared to) — re-validated per request.

async function buildDetail(
  replay: any,
  opening: any,
  viewerId: string,
  isOwner: boolean,
) {
  const db = getDb();
  const refs = await cardRefs([
    ...(opening.dealtHand as string[]),
    ...(opening.keptHand as string[]),
    ...(opening.resourced as string[]),
  ]);
  const enrich = (ids: string[]): OpeningCardRef[] => ids.map((id) => refs.get(id)!);

  const players = Array.isArray(replay.players) ? (replay.players as any[]) : [];
  const own = players.find((p: any) => p?.id === opening.recorderId) ?? null;
  const opp = players.find((p: any) => p?.id !== opening.recorderId) ?? null;

  const [mineRow] = await db
    .select()
    .from(openingResponses)
    .where(eq(openingResponses.replaySlug, replay.slug))
    .then((rows) => rows.filter((r) => r.userId === viewerId));
  const answered = !!mineRow;

  const detail: any = {
    replaySlug: replay.slug,
    ownLeader: own?.leader ?? null,
    ownBase: own?.base ?? null,
    oppLeader: opp?.leader ?? null,
    oppBase: opp?.base ?? null,
    format: (replay.match as any)?.gameFormat ?? null,
    wentFirst: opening.wentFirst,
    dealtHand: enrich(opening.dealtHand as string[]),
    keptHand: enrich(opening.keptHand as string[]),
    isOwner,
    answered,
    myResponse: mineRow
      ? { decision: mineRow.decision, resourced: mineRow.resourced }
      : null,
  };

  // The reveal — only once the viewer has committed an answer (or owns the
  // replay: their opening, their recorded decision).
  if (answered || isOwner) {
    let recorderName: string | null = null;
    if (replay.userId) {
      const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, replay.userId));
      recorderName = u?.name ?? null;
    }
    detail.reveal = {
      decision: opening.decision,
      resourced: enrich(opening.resourced as string[]),
      recorder: { userId: replay.userId ?? null, name: recorderName },
      mulliganFrameIndex: opening.mulliganFrameIndex,
      resourceFrameIndex: opening.resourceFrameIndex,
      responses: await visibleResponses(replay.slug, viewerId, { isOwner }),
    };
  }
  return detail;
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = await requireSession();
  if (s instanceof NextResponse) return s;

  const ent = await openingEntitlement(slug, s.userId);
  if (!ent) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });

  const detail = await buildDetail(ent.replay, ent.opening, s.userId, ent.isOwner);
  return NextResponse.json({ ok: true, data: detail });
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = await requireSession();
  if (s instanceof NextResponse) return s;

  const ent = await openingEntitlement(slug, s.userId);
  if (!ent) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  if (ent.isOwner) {
    return NextResponse.json({ ok: false, error: 'own opening' }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 });
  }
  const decision = body?.decision;
  const resourced = body?.resourced;
  if (decision !== 'keep' && decision !== 'mulligan') {
    return NextResponse.json({ ok: false, error: 'invalid decision' }, { status: 400 });
  }
  if (!Array.isArray(resourced) || resourced.length !== 2 || !resourced.every((r) => typeof r === 'string')) {
    return NextResponse.json({ ok: false, error: 'pick exactly 2 resources' }, { status: 400 });
  }
  // Multiset check: the picks must fit within the kept hand's copies (two
  // picks of the same cardId need two copies in hand).
  const avail = new Map<string, number>();
  for (const id of ent.opening.keptHand as string[]) avail.set(id, (avail.get(id) ?? 0) + 1);
  for (const id of resourced) {
    const n = avail.get(id) ?? 0;
    if (n <= 0) return NextResponse.json({ ok: false, error: 'resource not in hand' }, { status: 400 });
    avail.set(id, n - 1);
  }

  // Immutable: first answer counts (protects the consensus signal). A
  // conflicting re-POST is a no-op; the stored answer is what gets returned.
  await getDb()
    .insert(openingResponses)
    .values({ replaySlug: slug, userId: s.userId, decision, resourced })
    .onConflictDoNothing();

  const detail = await buildDetail(ent.replay, ent.opening, s.userId, ent.isOwner);
  return NextResponse.json({ ok: true, data: detail });
}
