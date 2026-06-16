// Active-team resolution (Phase A of the team-centric revamp).
//
// The app revolves around ONE active team at a time. Which team is active is
// persisted in the `kb_team` cookie and re-validated against the caller's
// memberships on every read — a stale slug (left a team, team deleted) silently
// falls back. Center nav is built from the active team; the "You" menu stays
// personal and never touches this.
//
// Cookie is WRITTEN only by POST /api/me/active-team (writes are illegal during
// RSC render). Here we only read.

import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { teams, teamMembers } from './schema';

export const ACTIVE_TEAM_COOKIE = 'kb_team';

export interface TeamRef {
  slug: string;
  name: string;
}

// The caller's teams, ordered by join time (oldest first) — the fallback
// "first team" is therefore the longest-standing membership. This query was
// duplicated across page.tsx / replays / clips / stats; route them all through
// here to kill the drift.
export async function getMyTeams(userId: string): Promise<TeamRef[]> {
  const db = getDb();
  return db
    .select({ slug: teams.slug, name: teams.name })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.slug, teamMembers.teamSlug))
    .where(eq(teamMembers.userId, userId))
    .orderBy(teamMembers.joinedAt);
}

// Pure selection rule, lifted out of the cookie/DB plumbing so it's unit-
// testable: a cookie slug that is still a membership wins; otherwise fall back
// to the first team; no teams → null.
export function selectActiveTeam(teams: TeamRef[], cookieSlug: string | null): TeamRef | null {
  if (teams.length === 0) return null;
  if (cookieSlug) {
    const match = teams.find((t) => t.slug === cookieSlug);
    if (match) return match;
  }
  return teams[0];
}

// Resolve the active team for a request: reads the kb_team cookie + the
// caller's memberships, then defers the choice to selectActiveTeam. Anonymous
// → no active team, no teams. Reading cookies() forces dynamic render — every
// call site is already force-dynamic.
export async function resolveActiveTeam(
  userId: string | null,
): Promise<{ active: TeamRef | null; teams: TeamRef[] }> {
  if (!userId) return { active: null, teams: [] };
  const myTeams = await getMyTeams(userId);
  const cookieSlug = (await cookies()).get(ACTIVE_TEAM_COOKIE)?.value ?? null;
  return { active: selectActiveTeam(myTeams, cookieSlug), teams: myTeams };
}
