// B166: double-sided replays as a RUNTIME composition of two independent rows.
//
// Every recorder of a karabast game keeps their OWN `replays` row (their POV) —
// teammates and opponents alike (B158/B166). A "double-sided" view is no longer
// a fold of the 2nd recording into the 1st recorder's row (the old
// `replay_alt_payload`); it is assembled on demand from the two sibling rows
// (same `gameId`, different recorders) when the viewer is entitled.
//
// Entitlement (re-evaluated per request, so leaving a team revokes it
// immediately while each recorder's own one-sided row is untouched):
//   - The two RECORDERS may compose iff they CURRENTLY share a team.
//   - A THIRD-PARTY viewer may compose iff they're on a team that contains BOTH
//     recorders AND the base replay is shared with that team.
// This mirrors the old B112/B137 boundary, now sourced from sibling rows and
// gated on live team membership.

import { and, eq, inArray, ne } from 'drizzle-orm';
import { getDb } from './db';
import { replays, replayTeamShares, teamMembers } from './schema';
import { sharedTeam } from './altPerspective';
import { isSampleReplaySlug } from './sampleReplays';

export type EntitledSibling = {
  slug: string;
  payloadBlobUrl: string;
  ownerPlayerId: string | null;
};

// The sibling recording the viewer may compose with `slug`, or null. (For a 1v1
// game there is at most one other recorder, so at most one sibling.)
export async function entitledSibling(
  slug: string,
  viewerUserId: string | null,
): Promise<EntitledSibling | null> {
  if (!viewerUserId) return null;        // anonymous never sees a hidden hand
  if (isSampleReplaySlug(slug)) return null; // anonymized samples never expose an alt

  const db = getDb();
  const [base] = await db
    .select({ gameId: replays.gameId, userId: replays.userId })
    .from(replays)
    .where(eq(replays.slug, slug))
    .limit(1);
  if (!base) return null;

  // Other recorders' rows for the SAME game. Only account-owned rows can pair —
  // the teammate check is account-based, so an anonymous (token-only) row can
  // never be composed.
  const siblings = await db
    .select({ slug: replays.slug, userId: replays.userId, ownerPlayerId: replays.ownerPlayerId, payloadBlobUrl: replays.payloadBlobUrl })
    .from(replays)
    .where(and(eq(replays.gameId, base.gameId), ne(replays.slug, slug)));

  for (const s of siblings) {
    if (!s.userId || s.userId === base.userId) continue;
    if (await canCompose(slug, base.userId, s.userId, viewerUserId)) {
      return { slug: s.slug, payloadBlobUrl: s.payloadBlobUrl, ownerPlayerId: s.ownerPlayerId ?? null };
    }
  }
  return null;
}

// Convenience for the viewer page's Flip gate.
export async function hasEntitledSibling(slug: string, viewerUserId: string | null): Promise<boolean> {
  return (await entitledSibling(slug, viewerUserId)) !== null;
}

// Batch "both POVs" signal for list surfaces (personal library, public, etc.):
// which of the given gameIds have a sibling recording owned by one of the
// viewer's current teammates — i.e. a double-sided view the viewer could
// compose. Returns the set of such gameIds. Viewer-relative + live, so it tracks
// team membership without any stored flag.
export async function doubleSidedGameIds(viewerUserId: string | null, gameIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!viewerUserId || gameIds.length === 0) return out;
  const db = getDb();

  const myTeams = await db
    .select({ t: teamMembers.teamSlug })
    .from(teamMembers)
    .where(eq(teamMembers.userId, viewerUserId));
  if (myTeams.length === 0) return out;
  const teammateRows = await db
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(inArray(teamMembers.teamSlug, myTeams.map((r) => r.t)));
  const teammates = new Set(teammateRows.map((r) => r.userId));

  const rows = await db
    .select({ gameId: replays.gameId, userId: replays.userId })
    .from(replays)
    .where(inArray(replays.gameId, gameIds));
  for (const r of rows) {
    if (r.userId && r.userId !== viewerUserId && teammates.has(r.userId)) out.add(r.gameId);
  }
  return out;
}

// Viewer-INDEPENDENT "a double-sided game exists" signal for list surfaces (the
// "both POVs" chip on public / review / tournament views): which of these
// gameIds were recorded by >=2 distinct accounts. (Whether a given viewer may
// COMPOSE/flip it is entitledSibling's job; this just flags that two POVs exist.)
export async function gameIdsWithSibling(gameIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (gameIds.length === 0) return out;
  const db = getDb();
  const rows = await db
    .select({ gameId: replays.gameId, userId: replays.userId, ownerToken: replays.ownerToken })
    .from(replays)
    .where(inArray(replays.gameId, gameIds));
  const byGame = new Map<string, Set<string>>();
  for (const r of rows) {
    const key = r.userId ?? `tok:${r.ownerToken}`;
    let s = byGame.get(r.gameId);
    if (!s) { s = new Set(); byGame.set(r.gameId, s); }
    s.add(key);
  }
  for (const [g, recorders] of byGame) if (recorders.size >= 2) out.add(g);
  return out;
}

async function canCompose(
  baseSlug: string,
  baseUserId: string | null,
  siblingUserId: string,
  viewerUserId: string,
): Promise<boolean> {
  const viewerIsRecorder = viewerUserId === baseUserId || viewerUserId === siblingUserId;
  if (viewerIsRecorder) {
    // The two recorders compose only while they currently share a team. (An
    // anonymous base row has no account/team, so it can never pair.)
    if (!baseUserId) return false;
    return await sharedTeam(baseUserId, siblingUserId);
  }
  return await thirdPartyCanCompose(baseSlug, baseUserId, siblingUserId, viewerUserId);
}

async function thirdPartyCanCompose(
  baseSlug: string,
  baseUserId: string | null,
  siblingUserId: string,
  viewerUserId: string,
): Promise<boolean> {
  if (!baseUserId) return false;
  const db = getDb();
  // Teams the base replay is shared with.
  const shares = await db
    .select({ t: replayTeamShares.teamSlug })
    .from(replayTeamShares)
    .where(eq(replayTeamShares.replaySlug, baseSlug));
  if (shares.length === 0) return false;
  const shareTeams = shares.map((s) => s.t);

  // Among those, a team containing the viewer AND both recorders.
  const memberRows = await db
    .select({ team: teamMembers.teamSlug, userId: teamMembers.userId })
    .from(teamMembers)
    .where(and(
      inArray(teamMembers.teamSlug, shareTeams),
      inArray(teamMembers.userId, [viewerUserId, baseUserId, siblingUserId]),
    ));
  const byTeam = new Map<string, Set<string>>();
  for (const m of memberRows) {
    let set = byTeam.get(m.team);
    if (!set) { set = new Set(); byTeam.set(m.team, set); }
    set.add(m.userId);
  }
  for (const set of byTeam.values()) {
    if (set.has(viewerUserId) && set.has(baseUserId) && set.has(siblingUserId)) return true;
  }
  return false;
}
