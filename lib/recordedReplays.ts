import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { replays, replayAltPayload } from './schema';

// B156 (privacy): the replays a user actually RECORDED — their own uploads
// (canonical owner) OR a double-sided game where they recorded the alt (2nd
// player) side. This is the membership rule for a user's personal library ("My
// replays" / "Clips of my replays").
//
// It deliberately EXCLUDES replays where the user is merely a resolved
// `replay_participants` entry. On upload, karabast handles for BOTH players are
// resolved to accounts and written to replay_participants, so an OPPONENT who
// never recorded the game still becomes a "participant". Surfacing those into a
// viewer's personal library leaked the opponent-owner's real name + the private
// teams THEY shared the replay with (scouting intel). Owner + alt-recorder cover
// every legitimate "I recorded this" case (the owner is always a participant of
// their own replay, and a co-recorder is tracked via the alt payload), so
// dropping the participant signal closes the leak with no loss.
export async function recordedReplaySlugs(userId: string): Promise<{
  slugs: string[];
  altSideBySlug: Map<string, string | null>;
}> {
  const db = getDb();
  const [own, alt] = await Promise.all([
    db.select({ slug: replays.slug }).from(replays).where(eq(replays.userId, userId)),
    db
      .select({ slug: replayAltPayload.replaySlug, altOwnerPlayerId: replayAltPayload.altOwnerPlayerId })
      .from(replayAltPayload)
      .where(eq(replayAltPayload.altUserId, userId)),
  ]);
  const altSideBySlug = new Map<string, string | null>();
  for (const a of alt) altSideBySlug.set(a.slug, a.altOwnerPlayerId);
  const slugs = Array.from(new Set([...own.map((r) => r.slug), ...alt.map((a) => a.slug)]));
  return { slugs, altSideBySlug };
}
