import { NextResponse } from 'next/server';
import { desc, isNotNull, count, inArray, and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { replays, tags } from '@/lib/schema';
import { serializeReplayRow } from '@/lib/replayRow';
import { gameIdsWithSibling } from '@/lib/doubleSided';
import { anonymizePlayersSummary } from '@/lib/anonymizeReplay';
import { orderPlayersOwnerFirst } from '@/lib/players';
import { cachedRead } from '@/lib/cached';

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
// Perf: global, no-auth, no-params list → cache the whole anonymized payload.
// Only changes when someone publishes/unpublishes, so a short TTL is plenty.
const getPublic = cachedRead(
  async () => {
  const db = getDb();
  const rows = await db
    .select()
    .from(replays)
    // B170: encrypted replays are never public (guarded at the setter); exclude
    // them here too so ciphertext can never surface on the public browser.
    .where(and(isNotNull(replays.publicAt), eq(replays.encrypted, false)))
    .orderBy(desc(replays.publicAt))
    .limit(200);

  const slugs = rows.map((r) => r.slug);
  // B166: "both POVs" = the game has >=2 distinct recorders (a sibling row).
  const dsGames = await gameIdsWithSibling(rows.map((r) => r.gameId));
  const commentCountBySlug = new Map<string, number>();
  if (slugs.length > 0) {
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
      doubleSided: dsGames.has(replay.gameId),
    }),
  );
  return data;
  },
  ['public-replays-v1'],
  { revalidate: 120, tags: ['public-replays'] },
);

export async function GET() {
  return NextResponse.json({ ok: true, data: await getPublic() });
}
