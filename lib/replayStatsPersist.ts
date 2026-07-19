// Materialize a replay's stats facts (match / match_players / card_events) and
// reconcile the derived Bo3 / sideboard / opening rollups. Best-effort — each
// step is guarded so one failure can't cost the others (matches the upload path's
// original inline behavior).
//
// Shared by TWO callers, both passing an EXPLICIT `winners` so a result persists
// identically regardless of how it was determined:
//   - the upload route (winners extracted from the payload), and
//   - manual result assignment (lib/replayResult), where a user asserts win/loss
//     for a karabast "leave game" that uploaded with no result.

import { decodeReplay } from './replayDecoder';
import { persistReplayFacts } from './statsPersist';
import { reconcileBo3ForReplay } from './bo3Reconcile';
import { reconcileSideboardsForReplay } from './sideboardPersist';
import { persistOpening } from './openingPersist';

export async function persistReplayStats(slug: string, parsed: any, gameId: string, winners: string[] | null): Promise<void> {
  let decoded: ReturnType<typeof decodeReplay>;
  try {
    decoded = decodeReplay(parsed);
  } catch (e) {
    console.error('[stats] decode failed for', slug, e);
    return;
  }
  try {
    await persistReplayFacts({
      decoded,
      replaySlug: slug,
      gameId,
      winners,
      ownerPlayerId: typeof parsed.localPlayerId === 'string' ? parsed.localPlayerId : null,
      durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : null,
    });
  } catch (e) {
    console.error('[stats] persistReplayFacts failed for', slug, e);
  }
  // B224: a Bo1 karabast converts to Bo3 records game 1 as bestOfOne — reconcile
  // the whole lobby's bo3 flags conversion-aware (self-heals when game 2 lands).
  await reconcileBo3ForReplay(parsed.match);
  // B227: sideboard decisions for the Bo3 drill pool — same self-healing reconcile.
  await reconcileSideboardsForReplay(parsed.match);
  // B221: opening facts ride the same decode; guarded separately.
  try {
    await persistOpening(decoded, slug);
  } catch (e) {
    console.error('[openings] persistOpening failed for', slug, e);
  }
}
