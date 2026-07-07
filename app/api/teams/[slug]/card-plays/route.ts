import { NextResponse } from 'next/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { replays, cardEvents } from '@/lib/schema';
import { surfacedReplaySlugs } from '@/lib/teamSurface';
import { requireTeamMember } from '@/lib/apiAuth';

export const runtime = 'nodejs';

// B226: card finder. GET /api/teams/[slug]/card-plays?cardId=SOR_001 →
//   { ok, plays: { <replaySlug>: <frameIndex> } }
// The team's surfaced replays in which the RECORDER (a team member) played that
// card, mapped to the FIRST frame it was played — so the Replays tab can narrow
// to those games and deep-link straight to the play (`/r/<slug>?f=frame+1`).
// Member-only. "Team side" = cardEvents.playerId === the replay's ownerPlayerId.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireTeamMember(slug);
  if (m instanceof NextResponse) return m;

  const cardId = (new URL(req.url).searchParams.get('cardId') || '').trim();
  if (!cardId) return NextResponse.json({ ok: false, error: 'cardId required' }, { status: 400 });

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
      eq(cardEvents.event, 'played'),
      inArray(replays.slug, surfaceSlugs),
    ))
    .groupBy(replays.slug);

  const plays: Record<string, number> = {};
  for (const r of rows) plays[r.slug] = Number(r.frame);
  return NextResponse.json({ ok: true, plays });
}
