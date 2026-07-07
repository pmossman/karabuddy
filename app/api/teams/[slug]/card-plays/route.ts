import { NextResponse } from 'next/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { replays, cardEvents } from '@/lib/schema';
import { surfacedReplaySlugs } from '@/lib/teamSurface';
import { requireTeamMember } from '@/lib/apiAuth';

export const runtime = 'nodejs';

// B226: card finder. GET /api/teams/[slug]/card-plays?cardId=SOR_001&event=played
//   → { ok, plays: { <replaySlug>: <frameIndex> } }
// The team's surfaced replays in which the RECORDER (a team member) did `event`
// with that card (played | resourced | drawn | discarded), mapped to the frame
// JUST BEFORE the first occurrence — so the Replays tab can narrow to those games
// and deep-link to the moment (stepping one frame forward does the thing, rather
// than opening on the aftermath). Member-only. "Team side" = cardEvents.playerId
// === the replay's ownerPlayerId.
const CARD_EVENTS = new Set(['played', 'resourced', 'drawn', 'discarded']);
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireTeamMember(slug);
  if (m instanceof NextResponse) return m;

  const url = new URL(req.url);
  const cardId = (url.searchParams.get('cardId') || '').trim();
  if (!cardId) return NextResponse.json({ ok: false, error: 'cardId required' }, { status: 400 });
  const event = (url.searchParams.get('event') || 'played').trim();
  if (!CARD_EVENTS.has(event)) return NextResponse.json({ ok: false, error: 'invalid event' }, { status: 400 });

  const surfaceSlugs = await surfacedReplaySlugs([slug]);
  if (surfaceSlugs.length === 0) return NextResponse.json({ ok: true, plays: {} });

  // cardEvents is indexed on (cardId, event), so filtering the card first is
  // cheap; the join to the recorder's own plays + the team scope narrows the
  // rest. min(frameIndex) = the first time the recorder played it that game.
  const rows = await getDb()
    .select({ slug: replays.slug, frame: sql<number>`min(${cardEvents.frameIndex})` })
    .from(cardEvents)
    .innerJoin(
      replays,
      and(eq(replays.gameId, cardEvents.gameId), eq(replays.ownerPlayerId, cardEvents.playerId)),
    )
    .where(and(
      eq(cardEvents.cardId, cardId),
      eq(cardEvents.event, event),
      inArray(replays.slug, surfaceSlugs),
    ))
    .groupBy(replays.slug);

  const plays: Record<string, number> = {};
  // Open one frame BEFORE the play so stepping forward shows the card go down.
  for (const r of rows) plays[r.slug] = Math.max(0, Number(r.frame) - 1);
  return NextResponse.json({ ok: true, plays });
}
