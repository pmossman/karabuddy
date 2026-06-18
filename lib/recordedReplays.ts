import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { replays } from './schema';

// B156/B166: the replays a user actually RECORDED — simply the rows they OWN.
//
// Every recorder keeps their own independent row, including the 2nd recorder of
// a co-recorded (double-sided) game (their own sibling row). The transitional
// alt-payload branch (used while the backfill was in flight) is gone now that
// the backfill is complete and `replay_alt_payload` is dropped.
//
// Still deliberately EXCLUDES replay_participants: an opponent's handle is
// resolved to them on upload, so surfacing participants leaked the opponent's
// name + their private team shares (B156).
export async function recordedReplaySlugs(userId: string): Promise<{ slugs: string[] }> {
  const db = getDb();
  const own = await db.select({ slug: replays.slug }).from(replays).where(eq(replays.userId, userId));
  return { slugs: own.map((r) => r.slug) };
}
