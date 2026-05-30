// Team replay surfacing rule, in one place.
//
// A replay surfaces to a team via either signal:
//   (a) The replay has a tag SCOPED to the team (tag_team_scope) — implicit
//   (b) The replay was explicitly shared with the team           — explicit
//
// B71 changed signal (a): it used to be "any tag authored by a team
// member", which leaked one team's discussion into every OTHER team the
// author belonged to (a replay tagged by a two-team member surfaced to
// both). Now a tag only surfaces a replay to the team(s) in its scope —
// personal tags (empty scope) surface to no team.
//
// Both `/api/teams/[slug]/replays` and `/api/teams/[slug]/discussion`
// list replays via this rule. `/api/me/labels` walks it across every
// team the caller is a member of. Single helper means the three
// surfaces can't drift.

import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from './db';
import { replayTeamShares, tags, tagTeamScope, teamMembers } from './schema';

// Membership-gate helper. Returns the membership row or null. Callers
// decide whether null is 401/403/etc — this stays pure DB.
export async function getTeamMembership(
  teamSlug: string,
  userId: string,
): Promise<{ teamSlug: string; userId: string; role: string } | null> {
  const db = getDb();
  const [me] = await db
    .select({ teamSlug: teamMembers.teamSlug, userId: teamMembers.userId, role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamSlug, teamSlug), eq(teamMembers.userId, userId)))
    .limit(1);
  return me ?? null;
}

// Compute slugs of replays surfaced to any of the given team(s).
// Returns deduped slug strings; empty array for empty input.
//
// O(teamSlugs + members + tags + shares). Pglite / Neon both handle this
// at our scale (low hundreds of replays per team) without an index dance.
export async function surfacedReplaySlugs(teamSlugs: string[]): Promise<string[]> {
  if (teamSlugs.length === 0) return [];
  const db = getDb();

  // Signal (a): the replay has a tag scoped to one of the team(s).
  // tag_team_scope holds (tagId, teamSlug); join back to tags for the
  // replay slug. Personal tags (no scope rows) never match here.
  const taggedSlugs = await db
    .selectDistinct({ slug: tags.replaySlug })
    .from(tagTeamScope)
    .innerJoin(tags, eq(tags.id, tagTeamScope.tagId))
    .where(inArray(tagTeamScope.teamSlug, teamSlugs));

  // Signal (b): explicit shares with the team(s).
  const sharedSlugs = await db
    .selectDistinct({ slug: replayTeamShares.replaySlug })
    .from(replayTeamShares)
    .where(inArray(replayTeamShares.teamSlug, teamSlugs));

  return Array.from(
    new Set([
      ...taggedSlugs.map((r) => r.slug),
      ...sharedSlugs.map((r) => r.slug),
    ])
  );
}

// Convenience: the team-slugs the caller belongs to. Used by callers
// (e.g. /api/me/labels) that need to walk surfacing across all of the
// caller's teams.
export async function getMyTeamSlugs(userId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ teamSlug: teamMembers.teamSlug })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId));
  return rows.map((r) => r.teamSlug);
}
