import { NextResponse } from 'next/server';
import { desc, isNotNull, count, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { replays, replayAltPayload, tags } from '@/lib/schema';
import { serializeReplayRow } from '@/lib/replayRow';
import { anonymizePlayersSummary } from '@/lib/anonymizeReplay';
import { orderPlayersOwnerFirst } from '@/lib/players';

export const runtime = 'nodejs';

// GET /api/replays/public — B133: the public browser. Replays whose owner
// explicitly published them, newest publication first. NO auth — public
// replays are the signed-out shop window (Parker: "helps users see the value
// of the app").
//
// Rows are ANONYMIZED for everyone — even your own — so the surface is
// uniformly stranger-safe: player handles become Player1/Player2 and the
// uploader's account name is never sent. (A user-set displayName shows; it's
// user-chosen.) Perspective = the uploader's side, so result/leader filters
// read consistently.
export async function GET() {
  const db = getDb();
  const rows = await db
    .select()
    .from(replays)
    .where(isNotNull(replays.publicAt))
    .orderBy(desc(replays.publicAt))
    .limit(200);

  const slugs = rows.map((r) => r.slug);
  const doubleSidedSlugs = new Set<string>();
  const commentCountBySlug = new Map<string, number>();
  if (slugs.length > 0) {
    const altRows = await db
      .select({ slug: replayAltPayload.replaySlug })
      .from(replayAltPayload)
      .where(inArray(replayAltPayload.replaySlug, slugs));
    for (const a of altRows) doubleSidedSlugs.add(a.slug);
    // Total comments — on a public replay every tag is publicly readable
    // (redacted), so the full count is the honest number.
    const countRows = await db
      .select({ replaySlug: tags.replaySlug, n: count() })
      .from(tags)
      .where(inArray(tags.replaySlug, slugs))
      .groupBy(tags.replaySlug);
    for (const c of countRows) commentCountBySlug.set(c.replaySlug, Number(c.n));
  }

  const data = rows.map((replay) =>
    // userId nulled: no uploader account ids on a stranger-facing surface.
    // Anonymize AFTER owner-first ordering so Player1 = the uploader's side,
    // matching the labels the anonymized viewer shows.
    serializeReplayRow({ ...replay, userId: null, players: anonymizePlayersSummary(orderPlayersOwnerFirst(replay.players, replay.ownerPlayerId) as any[]) }, {
      ownerName: null,
      viewerPlayerId: replay.ownerPlayerId ?? null,
      commentCount: commentCountBySlug.get(replay.slug) ?? 0,
      doubleSided: doubleSidedSlugs.has(replay.slug),
    }),
  );
  return NextResponse.json({ ok: true, data });
}
