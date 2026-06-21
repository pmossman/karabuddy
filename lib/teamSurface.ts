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
import { replays, replayTeamShares, tags, tagTeamScope, teamMembers } from './schema';

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

// Partition a team's recorded games into INTERNAL (teammate-vs-teammate) and
// EXTERNAL (a member vs an outsider), returning GAMEIDS. B166: a game is now up
// to two INDEPENDENT per-recorder rows, so classify by GAME (group rows by
// gameId, count the distinct team-member recorders): ≥2 member recorders →
// internal; exactly 1 → external. (Internal detection needs both teammates to
// have recorded; a one-sided recording reads as external.)
//
// Returns gameIds — NOT a representative slug. The earlier version returned the
// lexical-min sibling slug, but stats filter on `matches.replaySlug` which is
// the LAST-persisted sibling (statsPersist last-writer-wins); those two
// one-slug-per-game reductions disagreed ~50% of the time and silently dropped
// co-recorded games from the team matrix. A gameId set has no such ambiguity.
//
// Requires ≥1 sibling shared with the team (team stats stay "shared games only";
// ANY sibling's share counts, so a co-recorded game isn't dropped just because
// the teammate who armed the share isn't the last-persisted one).
export async function teamGameIds(teamSlug: string): Promise<{ internal: string[]; external: string[] }> {
  const db = getDb();
  // Every replay recorded by a member, with whether THAT replay is shared with
  // this team (leftJoin → sharedSlug null when unshared).
  const rows = await db
    .select({ gameId: replays.gameId, userId: replays.userId, sharedSlug: replayTeamShares.replaySlug })
    .from(replays)
    .innerJoin(teamMembers, and(eq(teamMembers.userId, replays.userId), eq(teamMembers.teamSlug, teamSlug)))
    .leftJoin(replayTeamShares, and(eq(replayTeamShares.replaySlug, replays.slug), eq(replayTeamShares.teamSlug, teamSlug)));
  const byGame = new Map<string, { recorders: Set<string>; shared: boolean }>();
  for (const r of rows) {
    if (!r.userId || !r.gameId) continue;
    let g = byGame.get(r.gameId);
    if (!g) { g = { recorders: new Set(), shared: false }; byGame.set(r.gameId, g); }
    g.recorders.add(r.userId);
    if (r.sharedSlug) g.shared = true; // ANY sibling shared with the team
  }
  const internal: string[] = [];
  const external: string[] = [];
  for (const [gameId, g] of byGame) {
    if (!g.shared) continue; // team stats = games shared with the team
    (g.recorders.size >= 2 ? internal : external).push(gameId);
  }
  return { internal, external };
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
