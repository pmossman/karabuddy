// Team-relationship predicates for replays. B166: the double-sided viewing
// boundary moved to lib/doubleSided.ts (entitledSibling), composed at runtime
// from the two independent per-recorder rows. This file keeps the
// account-relationship helpers (sharedTeam) and the identity-anonymization gate
// (canViewReplayIdentities) that several surfaces still share.
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from './db';
import { teamMembers } from './schema';
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
