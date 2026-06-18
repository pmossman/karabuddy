import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { replays, replayAltPayload } from './schema';

// B156/B166: the replays a user actually RECORDED — their own rows, plus (during
// the B166 migration) the canonical of a co-recorded game they were the 2nd
// recorder of.
//
// B166 transitional dedup: every recorder is being migrated to their own
// independent row (the 2nd recorder used to be folded into the 1st recorder's
// replay_alt_payload). A backfill materializes those sibling rows. To stay
// correct on BOTH sides of that backfill with ZERO duplication:
//   - include my own rows (`replays.userId == me`), AND
//   - include a canonical-via-alt ONLY while I don't yet OWN a row for that game.
// Pre-backfill I have no sibling, so the alt entry shows (exactly as before);
// once the backfill gives me a sibling, the alt entry drops out — so the game is
// never listed twice while old and new code overlap during the deploy. The whole
// alt branch is removed in the contract step once the backfill is complete and
// alt_payload is dropped.
//
// Still deliberately EXCLUDES replay_participants: an opponent's handle is
// resolved to them on upload, so surfacing participants leaked the opponent's
// name + their private team shares (B156).
export async function recordedReplaySlugs(userId: string): Promise<{
  slugs: string[];
  altSideBySlug: Map<string, string | null>;
}> {
  const db = getDb();
  const own = await db
    .select({ slug: replays.slug, gameId: replays.gameId })
    .from(replays)
    .where(eq(replays.userId, userId));
  const ownGameIds = new Set(own.map((r) => r.gameId));

  const altRows = await db
    .select({ slug: replayAltPayload.replaySlug, altOwnerPlayerId: replayAltPayload.altOwnerPlayerId, gameId: replays.gameId })
    .from(replayAltPayload)
    .innerJoin(replays, eq(replays.slug, replayAltPayload.replaySlug))
    .where(eq(replayAltPayload.altUserId, userId));

  const altSideBySlug = new Map<string, string | null>();
  const altSlugs: string[] = [];
  for (const a of altRows) {
    if (ownGameIds.has(a.gameId)) continue; // I already own a row for this game → no duplicate
    altSideBySlug.set(a.slug, a.altOwnerPlayerId ?? null);
    altSlugs.push(a.slug);
  }

  const slugs = Array.from(new Set([...own.map((r) => r.slug), ...altSlugs]));
  return { slugs, altSideBySlug };
}
