// B149 / ADR 0009: the durable, multi-reviewer review model. A "review" is an
// explicit per-user mark (replay_reviews row) — marks accumulate ("reviewed by
// N") and never wipe the request (which lives on the share's review_requested_at
// and persists). These helpers are the write + read side; the routes own the
// auth gates (owner requests; members mark, requested-only).
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from './db';
import { replayReviews, tags, tagTeamScope, users } from './schema';

export interface ReviewerMark { userId: string; name: string | null; reviewedAt: string }
export interface CommenterSummary { names: string[]; count: number }

// Upsert the acting user's review mark for (replay, team). Idempotent — the
// unique (replay, team, reviewer) index makes a repeat a no-op.
export async function markReviewed(replaySlug: string, teamSlug: string, reviewerUserId: string): Promise<void> {
  const db = getDb();
  await db
    .insert(replayReviews)
    .values({ id: crypto.randomUUID(), replaySlug, teamSlug, reviewerUserId })
    .onConflictDoNothing();
}

// Remove the acting user's review mark (un-review).
export async function unmarkReviewed(replaySlug: string, teamSlug: string, reviewerUserId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(replayReviews)
    .where(and(
      eq(replayReviews.replaySlug, replaySlug),
      eq(replayReviews.teamSlug, teamSlug),
      eq(replayReviews.reviewerUserId, reviewerUserId),
    ));
}

// Reviewer marks (with names) for a set of replays within ONE team, keyed by
// replay slug. Drives the team Reviews tab's "reviewed by N" avatars.
export async function reviewersForTeam(replaySlugs: string[], teamSlug: string): Promise<Map<string, ReviewerMark[]>> {
  const out = new Map<string, ReviewerMark[]>();
  if (replaySlugs.length === 0) return out;
  const db = getDb();
  const rows = await db
    .select({
      replaySlug: replayReviews.replaySlug,
      userId: replayReviews.reviewerUserId,
      name: users.name,
      reviewedAt: replayReviews.reviewedAt,
    })
    .from(replayReviews)
    .leftJoin(users, eq(users.id, replayReviews.reviewerUserId))
    .where(and(eq(replayReviews.teamSlug, teamSlug), inArray(replayReviews.replaySlug, replaySlugs)));
  for (const r of rows) {
    const list = out.get(r.replaySlug) ?? [];
    list.push({ userId: r.userId, name: r.name, reviewedAt: r.reviewedAt.toISOString() });
    out.set(r.replaySlug, list);
  }
  return out;
}

// Reviewer COUNTS for a set of replays across ALL teams the requester asked for,
// keyed by `${replaySlug}::${teamSlug}` — for the requester's "my requests"
// surface (how many eyes per team).
export async function reviewCountsByShare(replaySlugs: string[]): Promise<Map<string, ReviewerMark[]>> {
  const out = new Map<string, ReviewerMark[]>();
  if (replaySlugs.length === 0) return out;
  const db = getDb();
  const rows = await db
    .select({
      replaySlug: replayReviews.replaySlug,
      teamSlug: replayReviews.teamSlug,
      userId: replayReviews.reviewerUserId,
      name: users.name,
      reviewedAt: replayReviews.reviewedAt,
    })
    .from(replayReviews)
    .leftJoin(users, eq(users.id, replayReviews.reviewerUserId))
    .where(inArray(replayReviews.replaySlug, replaySlugs));
  for (const r of rows) {
    const key = `${r.replaySlug}::${r.teamSlug}`;
    const list = out.get(key) ?? [];
    list.push({ userId: r.userId, name: r.name, reviewedAt: r.reviewedAt.toISOString() });
    out.set(key, list);
  }
  return out;
}

// Slugs (from the given set) where `userId` authored a tag scoped to `teamSlug`
// — i.e. they left feedback the team can see. Gates the "I reviewed" mark: you
// can't claim a review without having commented on the replay.
export async function viewerCommentedSlugs(replaySlugs: string[], teamSlug: string, userId: string | null): Promise<Set<string>> {
  if (replaySlugs.length === 0 || !userId) return new Set();
  const db = getDb();
  const rows = await db
    .selectDistinct({ slug: tags.replaySlug })
    .from(tags)
    .innerJoin(tagTeamScope, eq(tagTeamScope.tagId, tags.id))
    .where(and(eq(tagTeamScope.teamSlug, teamSlug), eq(tags.userId, userId), inArray(tags.replaySlug, replaySlugs)));
  return new Set(rows.map((r) => r.slug));
}

// Distinct team-scoped commenters (who left tags VISIBLE to the team, via
// tag_team_scope) per replay, with a tag count — the "tags shown" side of the
// review surface (reviewed vs commented are both visible). Personal tags (no
// team scope) don't surface to the team, mirroring the scoping boundary.
export async function commentersForTeam(replaySlugs: string[], teamSlug: string): Promise<Map<string, CommenterSummary>> {
  const out = new Map<string, CommenterSummary>();
  if (replaySlugs.length === 0) return out;
  const db = getDb();
  const rows = await db
    .select({ replaySlug: tags.replaySlug, authorName: tags.authorName })
    .from(tags)
    .innerJoin(tagTeamScope, eq(tagTeamScope.tagId, tags.id))
    .where(and(eq(tagTeamScope.teamSlug, teamSlug), inArray(tags.replaySlug, replaySlugs)));
  const seen = new Map<string, Set<string>>();
  for (const r of rows) {
    const cur = out.get(r.replaySlug) ?? { names: [], count: 0 };
    cur.count += 1;
    const names = seen.get(r.replaySlug) ?? new Set<string>();
    if (r.authorName && !names.has(r.authorName)) { names.add(r.authorName); cur.names.push(r.authorName); }
    seen.set(r.replaySlug, names);
    out.set(r.replaySlug, cur);
  }
  return out;
}
