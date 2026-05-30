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

import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from './db';
import { replayTeamShares, tagTeamScope, teamMembers } from './schema';

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
