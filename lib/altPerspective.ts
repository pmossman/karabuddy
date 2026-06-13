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
import { canMutateReplay, type AuthContext } from './replayPermissions';

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

// B122: may the caller see this replay's REAL identities (karabast usernames,
// full deck lists, username-based title)? True iff they OWN the replay (account
// or install token) OR share a team with the uploader. Otherwise the viewer /
// API / OG card anonymizes (Player vs Opponent, leader-matchup title). The
// privacy boundary for public replay links — keep it the single source of truth.
export async function canViewReplayIdentities(
  replay: { userId?: string | null; ownerToken: string },
  ctx: AuthContext,
): Promise<boolean> {
  if (canMutateReplay(replay, ctx)) return true; // the uploader
  if (ctx.sessionUserId && replay.userId && (await sharedTeam(replay.userId, ctx.sessionUserId))) return true; // a teammate
  return false;
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

  // B137: the two people who RECORDED this game (canonical uploader + alt
  // recorder) may always flip to their own two-sided view — they were both in
  // the match and already saw their own hands; consent is implicit. The
  // team-share rule below is what governs OTHER teammates seeing it. Without
  // this, a double-sided replay the owner never shared locked BOTH players out
  // of their own game even though the alt was retained.
  if (viewerUserId === rep.userId || viewerUserId === alt.altUserId) return true;

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
