import { NextResponse } from 'next/server';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { replays, cardEvents } from '@/lib/schema';
import { surfacedReplaySlugs } from '@/lib/teamSurface';
import { requireSession, requireTeamMember } from '@/lib/apiAuth';

export const runtime = 'nodejs';

// B226: card finder (unified scope). GET /api/card-plays?cardId=SOR_001&event=played&team=abcd
//   → { ok, plays: { <replaySlug>: <frameIndex> } }
// Replays in which the RECORDER did `event` (played | resourced | drawn |
// discarded) with the card, mapped to the frame JUST BEFORE the first
// occurrence (step one forward to see it happen). Scope:
//   team=<slug> → that team's surfaced replays (member-only), OR
//   no team     → the signed-in viewer's OWN replays.
// "Recorder side" = cardEvents.playerId === the replay's ownerPlayerId. Shared
// by the team Replays tab AND the personal library — one behaviour, two scopes.
const CARD_EVENTS = new Set(['played', 'resourced', 'drawn', 'discarded']);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const cardId = (url.searchParams.get('cardId') || '').trim();
  if (!cardId) return NextResponse.json({ ok: false, error: 'cardId required' }, { status: 400 });
  const event = (url.searchParams.get('event') || 'played').trim();
  if (!CARD_EVENTS.has(event)) return NextResponse.json({ ok: false, error: 'invalid event' }, { status: 400 });
  const team = (url.searchParams.get('team') || '').trim();

  let scope: SQL;
  if (team) {
    const m = await requireTeamMember(team);
    if (m instanceof NextResponse) return m;
    const surfaceSlugs = await surfacedReplaySlugs([team]);
    if (surfaceSlugs.length === 0) return NextResponse.json({ ok: true, plays: {} });
    scope = inArray(replays.slug, surfaceSlugs);
  } else {
    const s = await requireSession();
    if (s instanceof NextResponse) return s;
    scope = eq(replays.userId, s.userId);
  }

  // cardEvents is indexed on (cardId, event), so filtering the card first is
  // cheap; the join to the recorder's own plays + the scope narrows the rest.
  const rows = await getDb()
    .select({ slug: replays.slug, frame: sql<number>`min(${cardEvents.frameIndex})` })
    .from(cardEvents)
    .innerJoin(
      replays,
      and(eq(replays.gameId, cardEvents.gameId), eq(replays.ownerPlayerId, cardEvents.playerId)),
    )
    .where(and(eq(cardEvents.cardId, cardId), eq(cardEvents.event, event), scope))
    .groupBy(replays.slug);

  const plays: Record<string, number> = {};
  // Open one frame BEFORE so stepping forward shows the card go down.
  for (const r of rows) plays[r.slug] = Math.max(0, Number(r.frame) - 1);
  return NextResponse.json({ ok: true, plays });
}
