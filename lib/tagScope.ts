// B71: per-tag team scope (comment audience) — write-side helper.
//
// A tag is visible to a SUBSET of the teams the replay is shared with.
// Empty subset = personal (author only). Two invariants enforced here so
// every write path (web /tags endpoint + extension upload lift) agrees:
//
//   audience ⊆ replay shares   — a comment can't reach a team that can't
//                                see the replay (no orphan comments).
//   author ∈ each scoped team  — you can only scope to your own teams.
//
// Default (no explicit request) = all of the replay's shared teams the
// author belongs to. An explicit request is intersected down to the same
// bounds. The caller writes the returned slugs into tag_team_scope.

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getDb } from './db';
import { replayTeamShares, tags, tagTeamScope, teamMembers } from './schema';

// Compute the effective scope for a tag.
//   requested: undefined/null → default to the replay's shares; an array
//   (incl. []) → that explicit set. Either way the result is intersected
//   to (replay shares ∩ author's memberships). [] ⇒ personal.
export async function resolveTagScope(opts: {
  replaySlug: string;
  authorUserId: string | null;
  requested?: string[] | null;
}): Promise<string[]> {
  const { replaySlug, authorUserId, requested } = opts;

  // Anonymous authors (no account) can't be a team member, so they can't
  // scope to any team — their tags are always personal.
  if (!authorUserId) return [];

  const db = getDb();

  // Bound 1: the teams the replay is shared with.
  const shareRows = await db
    .select({ teamSlug: replayTeamShares.teamSlug })
    .from(replayTeamShares)
    .where(eq(replayTeamShares.replaySlug, replaySlug));
  const shares = shareRows.map((r) => r.teamSlug);
  if (shares.length === 0) return [];

  // Bound 2: which of those the author actually belongs to.
  const memberRows = await db
    .select({ teamSlug: teamMembers.teamSlug })
    .from(teamMembers)
    .where(and(eq(teamMembers.userId, authorUserId), inArray(teamMembers.teamSlug, shares)));
  const eligible = new Set(memberRows.map((r) => r.teamSlug));
  if (eligible.size === 0) return [];

  // Default = every eligible team; explicit request = the intersection of
  // what was asked for with the eligible set.
  if (requested == null) return Array.from(eligible);
  return requested.filter((slug) => eligible.has(slug));
}

// Viewer-side visibility predicate (pure, unit-testable). A tag is visible
// to a viewer when they authored it (by account or install token) or when
// it's scoped to a team the viewer belongs to. Personal tags (empty scope)
// are visible only to their author.
export function tagVisibleToViewer(
  tag: { userId: string | null; authorToken: string },
  scope: Set<string>,
  viewer: { userId: string | null; installToken: string | null; teams: Set<string> },
): boolean {
  if (viewer.userId && tag.userId === viewer.userId) return true;
  if (viewer.installToken && tag.authorToken === viewer.installToken) return true;
  for (const teamSlug of scope) if (viewer.teams.has(teamSlug)) return true;
  return false;
}

// Load the team-scope sets for a batch of tag ids → Map<tagId, Set<slug>>.
// Tags with no rows simply get an empty set (personal).
export async function loadTagScopes(tagIds: string[]): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  if (tagIds.length === 0) return map;
  const db = getDb();
  const rows = await db
    .select({ tagId: tagTeamScope.tagId, teamSlug: tagTeamScope.teamSlug })
    .from(tagTeamScope)
    .where(inArray(tagTeamScope.tagId, tagIds));
  for (const row of rows) {
    let set = map.get(row.tagId);
    if (!set) { set = new Set(); map.set(row.tagId, set); }
    set.add(row.teamSlug);
  }
  return map;
}

// One-shot migration backfill (B71). Pre-B71 tags carry no scope rows;
// surfacing used to be "tagged by a member", so they leaked. We recover
// the unambiguous cases: a tag on a replay shared with EXACTLY ONE team
// is scoped to that team (it could only have been meant for them).
// Replays shared with 0 or 2+ teams stay personal (we can't infer intent).
//
// NOT idempotent w.r.t. intentionally-personal tags: re-running after
// go-live would wrongly scope a deliberately-personal comment on a
// single-share replay. Run once, before/at B71 deploy.
export async function backfillTagScopes(): Promise<{ scanned: number; scoped: number }> {
  const db = getDb();
  // Tags with no scope rows (pre-B71 / personal).
  const unscoped = await db
    .select({ id: tags.id, replaySlug: tags.replaySlug })
    .from(tags)
    .leftJoin(tagTeamScope, eq(tagTeamScope.tagId, tags.id))
    .where(isNull(tagTeamScope.tagId));
  if (unscoped.length === 0) return { scanned: 0, scoped: 0 };

  const slugs = Array.from(new Set(unscoped.map((t) => t.replaySlug)));
  const shareRows = await db
    .select({ replaySlug: replayTeamShares.replaySlug, teamSlug: replayTeamShares.teamSlug })
    .from(replayTeamShares)
    .where(inArray(replayTeamShares.replaySlug, slugs));
  const sharesByReplay = new Map<string, string[]>();
  for (const r of shareRows) {
    const list = sharesByReplay.get(r.replaySlug) ?? [];
    list.push(r.teamSlug);
    sharesByReplay.set(r.replaySlug, list);
  }

  const inserts: { tagId: string; teamSlug: string }[] = [];
  for (const t of unscoped) {
    const shares = sharesByReplay.get(t.replaySlug) ?? [];
    if (shares.length === 1) inserts.push({ tagId: t.id, teamSlug: shares[0] });
  }
  if (inserts.length > 0) {
    await db.insert(tagTeamScope).values(inserts).onConflictDoNothing();
  }
  return { scanned: unscoped.length, scoped: inserts.length };
}

// Persist a tag's scope. Callers insert fresh tags, so there are no prior
// rows to clear; onConflictDoNothing guards the re-lift-on-reupload path.
export async function writeTagScope(tagId: string, teamSlugs: string[]): Promise<void> {
  if (teamSlugs.length === 0) return;
  const db = getDb();
  await db
    .insert(tagTeamScope)
    .values(teamSlugs.map((teamSlug) => ({ tagId, teamSlug })))
    .onConflictDoNothing();
}
