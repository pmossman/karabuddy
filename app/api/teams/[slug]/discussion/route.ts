import { NextResponse } from 'next/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { replays, tags, tagTeamScope, users } from '@/lib/schema';
import { surfacedReplaySlugs } from '@/lib/teamSurface';
import { requireTeamMember } from '@/lib/apiAuth';
import { orderPlayersOwnerFirst } from '@/lib/players';

export const runtime = 'nodejs';

// GET /api/teams/[slug]/discussion — replays that have active tag
// discussion, scoped to this team. Same surface rule as /replays
// (lib/teamSurface) but the SHAPE is different: per-replay aggregation
// (latest comment, participant list, tag count) sorted by latest-tag DESC.
//
// Replays with zero tags don't appear here — those belong in the inventory
// section below the Discussion feed on the team page. B61.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireTeamMember(slug);
  if (m instanceof NextResponse) return m;

  const surfaceSlugs = await surfacedReplaySlugs([slug]);
  if (surfaceSlugs.length === 0) {
    return NextResponse.json({ ok: true, data: [] });
  }

  const db = getDb();

  // All tags on the surfaced slugs that are SCOPED to THIS team, with
  // author user JOIN'd in for image+name. LEFT JOIN users because tags
  // can be authored anonymously (authorToken, no userId). The INNER JOIN
  // on tag_team_scope is the B71 privacy gate: a comment scoped to a
  // different team (or personal) never appears in this team's feed, even
  // when the underlying replay is visible to this team.
  const tagRows = await db
    .select({
      id: tags.id,
      replaySlug: tags.replaySlug,
      frameIndex: tags.frameIndex,
      userId: tags.userId,
      authorToken: tags.authorToken,
      authorName: tags.authorName,
      comment: tags.comment,
      mentions: tags.mentions,
      createdAt: tags.createdAt,
      authorImage: users.image,
      authorUserName: users.name,
    })
    .from(tags)
    .innerJoin(tagTeamScope, and(eq(tagTeamScope.tagId, tags.id), eq(tagTeamScope.teamSlug, slug)))
    .leftJoin(users, eq(users.id, tags.userId))
    .where(inArray(tags.replaySlug, surfaceSlugs))
    .orderBy(desc(tags.createdAt));

  if (tagRows.length === 0) {
    return NextResponse.json({ ok: true, data: [] });
  }

  type Participant = { userId: string | null; name: string; image: string | null };
  type Aggregate = {
    latest: (typeof tagRows)[number];
    count: number;
    participants: Map<string, Participant>;
  };
  const grouped = new Map<string, Aggregate>();
  for (const row of tagRows) {
    let agg = grouped.get(row.replaySlug);
    if (!agg) {
      agg = { latest: row, count: 0, participants: new Map() };
      grouped.set(row.replaySlug, agg);
    }
    // tagRows are DESC by createdAt — first one we see per slug is the latest.
    agg.count++;
    const key = row.userId || row.authorToken;
    if (!agg.participants.has(key)) {
      agg.participants.set(key, {
        userId: row.userId,
        // Prefer the user account's display name; fall back to the
        // authorName captured at tag-write time (anon-XXX for anonymous).
        name: row.authorUserName || row.authorName,
        image: row.authorImage,
      });
    }
  }

  const survivingSlugs = Array.from(grouped.keys());
  const replayRows = await db
    .select()
    .from(replays)
    .where(inArray(replays.slug, survivingSlugs));
  const replayMap = new Map(replayRows.map((r) => [r.slug, r]));

  const items = Array.from(grouped.entries())
    .map(([replaySlug, agg]) => {
      const replay = replayMap.get(replaySlug);
      if (!replay) return null;
      return {
        slug: replaySlug,
        // B59-followup: owner-first ordering for the matchup mini-thumbs.
        players: orderPlayersOwnerFirst(replay.players, replay.ownerPlayerId),
        displayName: replay.displayName,
        latestTag: {
          id: agg.latest.id,
          comment: agg.latest.comment,
          authorName: agg.latest.authorUserName || agg.latest.authorName,
          authorImage: agg.latest.authorImage,
          userId: agg.latest.userId,
          frameIndex: agg.latest.frameIndex,
          createdAt: agg.latest.createdAt.toISOString(),
          mentions: agg.latest.mentions ?? null,
        },
        tagCount: agg.count,
        participants: Array.from(agg.participants.values()),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => (a.latestTag.createdAt < b.latestTag.createdAt ? 1 : -1));

  return NextResponse.json({ ok: true, data: items });
}
