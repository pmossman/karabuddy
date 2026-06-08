// B112: double-sided replays — the authorization boundary for the second
// perspective (which reveals a player's otherwise-hidden hand). Shared by the
// viewer page (`canFlip`) and the serving endpoint so there is ONE predicate.
//
// Rule: the alt perspective is viewable iff the viewer is a signed-in member of
// a team the replay is SHARED with, AND BOTH recorders are members of that same
// team. Re-evaluated per request (no stored "eligible" flag), so a participant
// leaving the team immediately revokes access.
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from './db';
import { replays, replayAltPayload, replayTeamShares, teamMembers } from './schema';
import { getMyTeamSlugs } from './teamSurface';
import { isSampleReplaySlug } from './sampleReplays';

// Do these two accounts share at least one team? Used at upload time to decide
// whether to RETAIN the 2nd recording as an alt (the storage-side privacy gate).
export async function sharedTeam(userIdA: string, userIdB: string): Promise<boolean> {
  if (!userIdA || !userIdB || userIdA === userIdB) return false;
  const db = getDb();
  const aTeams = await db
    .select({ t: teamMembers.teamSlug })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userIdA));
  if (aTeams.length === 0) return false;
  const [row] = await db
    .select({ t: teamMembers.teamSlug })
    .from(teamMembers)
    .where(and(eq(teamMembers.userId, userIdB), inArray(teamMembers.teamSlug, aTeams.map((r) => r.t))))
    .limit(1);
  return !!row;
}

// Is `viewerUserId` allowed to see the alt perspective of `slug`?
export async function canViewAltPerspective(slug: string, viewerUserId: string | null): Promise<boolean> {
  if (!viewerUserId) return false;            // anonymous never sees a hidden hand
  if (isSampleReplaySlug(slug)) return false; // anonymized samples never expose an alt
  const db = getDb();

  const [alt] = await db
    .select({ altUserId: replayAltPayload.altUserId })
    .from(replayAltPayload)
    .where(eq(replayAltPayload.replaySlug, slug))
    .limit(1);
  if (!alt?.altUserId) return false; // no alt stored, or its recorder's account is gone

  const [rep] = await db
    .select({ userId: replays.userId })
    .from(replays)
    .where(eq(replays.slug, slug))
    .limit(1);
  if (!rep?.userId) return false; // canonical recorder's account is gone

  // Candidate teams = teams the VIEWER belongs to that the replay is shared with.
  // (viewer-membership is satisfied by construction since these come from the
  // viewer's own team list.)
  const viewerTeams = await getMyTeamSlugs(viewerUserId);
  if (viewerTeams.length === 0) return false;
  const shareRows = await db
    .select({ t: replayTeamShares.teamSlug })
    .from(replayTeamShares)
    .where(and(eq(replayTeamShares.replaySlug, slug), inArray(replayTeamShares.teamSlug, viewerTeams)));
  const candidate = shareRows.map((r) => r.t);
  if (candidate.length === 0) return false;

  // Require a candidate team containing BOTH recorders.
  const recorders = [rep.userId, alt.altUserId];
  const memberRows = await db
    .select({ team: teamMembers.teamSlug, userId: teamMembers.userId })
    .from(teamMembers)
    .where(and(inArray(teamMembers.teamSlug, candidate), inArray(teamMembers.userId, recorders)));
  const byTeam = new Map<string, Set<string>>();
  for (const r of memberRows) {
    let set = byTeam.get(r.team);
    if (!set) { set = new Set(); byTeam.set(r.team, set); }
    set.add(r.userId);
  }
  for (const set of byTeam.values()) {
    if (set.has(rep.userId) && set.has(alt.altUserId)) return true;
  }
  return false;
}

// Fetch the alt payload + its localPlayerId for serving. Call ONLY after
// canViewAltPerspective has passed.
export async function loadAltPayloadForServing(
  slug: string,
): Promise<{ payload: string; altOwnerPlayerId: string | null } | null> {
  const db = getDb();
  const [row] = await db
    .select({ payload: replayAltPayload.payload, altOwnerPlayerId: replayAltPayload.altOwnerPlayerId })
    .from(replayAltPayload)
    .where(eq(replayAltPayload.replaySlug, slug))
    .limit(1);
  return row ? { payload: row.payload, altOwnerPlayerId: row.altOwnerPlayerId ?? null } : null;
}
