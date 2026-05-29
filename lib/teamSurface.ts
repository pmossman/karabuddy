// Team replay surfacing rule, in one place.
//
// A replay surfaces to a team via either signal:
//   (a) Any tag on the replay was authored by a team member  — implicit
//   (b) The replay was explicitly shared with the team       — explicit
//
// Both `/api/teams/[slug]/replays` and `/api/teams/[slug]/discussion`
// list replays via this rule. `/api/me/labels` walks it across every
// team the caller is a member of. Single helper means the three
// surfaces can't drift.

import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from './db';
import { replayTeamShares, tags, teamMembers } from './schema';

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

  // All members across the given teams — signal (a) needs their userIds
  // to look up tag authorship.
  const memberRows = await db
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(inArray(teamMembers.teamSlug, teamSlugs));
  const memberIds = Array.from(new Set(memberRows.map((m) => m.userId)));

  // Signal (a): tagged-by-member.
  const taggedSlugs = memberIds.length > 0
    ? await db
        .selectDistinct({ slug: tags.replaySlug })
        .from(tags)
        .where(inArray(tags.userId, memberIds))
    : [];

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
