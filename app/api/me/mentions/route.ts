import { NextResponse } from 'next/server';
import { desc, eq, inArray, or, sql } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { replays, tags, teamMembers, users } from '@/lib/schema';

export const runtime = 'nodejs';

// GET /api/me/mentions — list tags that mention the signed-in user OR
// any of their teams. Sorted recency-first. Used by:
//   - /mentions inbox page
//   - the header unread badge (we surface `?unreadOnly=1&count=1` for
//     just a count; full list when the page loads)
//
// "Mention me" means tag.mentions.userIds contains my userId.
// "Mention my team" means tag.mentions.teamSlugs contains a slug of a
// team I'm in.
//
// We DON'T return tags where I'm the author — getting notified about
// your own @-self mentions would be noise.
export async function GET(req: Request) {
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  }
  const db = getDb();

  // Get my team slugs for the team-mention check.
  const teamRows = await db
    .select({ slug: teamMembers.teamSlug })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId));
  const mySlugs = teamRows.map((r) => r.slug);

  // Postgres jsonb predicate: `mentions->'userIds' @> '["<userId>"]'`
  // matches if the array contains my id. Same for teamSlugs.
  // We OR these together; null mentions are correctly skipped because
  // `null @> any` is null (falsy).
  const userIdsPredicate = sql`${tags.mentions}->'userIds' @> ${JSON.stringify([userId])}::jsonb`;
  const teamPredicates = mySlugs.length > 0
    ? sql`${tags.mentions}->'teamSlugs' ?| ${sql.raw(`ARRAY[${mySlugs.map((s) => `'${s.replace(/'/g, "''")}'`).join(',')}]::text[]`)}`
    : null;

  const condition = teamPredicates
    ? sql`(${userIdsPredicate}) OR (${teamPredicates})`
    : userIdsPredicate;

  // Don't notify on self-authored mentions (silly).
  const finalCondition = sql`(${condition}) AND (${tags.userId} IS DISTINCT FROM ${userId})`;

  const rows = await db
    .select({
      id: tags.id,
      replaySlug: tags.replaySlug,
      frameIndex: tags.frameIndex,
      authorName: tags.authorName,
      comment: tags.comment,
      mentions: tags.mentions,
      createdAt: tags.createdAt,
      replayPlayers: replays.players,
      replayMatch: replays.match,
    })
    .from(tags)
    .innerJoin(replays, eq(replays.slug, tags.replaySlug))
    .where(finalCondition)
    .orderBy(desc(tags.createdAt))
    .limit(50);

  return NextResponse.json({ ok: true, data: rows });
}
