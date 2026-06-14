// B134/B136/B138: per-frame playback dwell (ms) — how long autoplay / a clip
// reel should sit on each frame so the FrameAnimator's choreography plays out
// instead of glitching past. Shared by the replay viewer's autoplay AND the
// clip reel player so the two always agree. Pure (frames in, ms[] out).
//
// B147 / ADR 0008: this is now a THIN consumer of the replay timeline
// (`buildTimeline`) — the single, geometry-free source of truth for what
// animates on each frame and how long the longest beat runs. The dwell adds one
// thing the timeline leaves to the player: the player-handoff pause inserted
// when the acting player changes between consecutive beats.
import type { Frame } from '@/lib/replayDecoder';
import { buildTimeline } from './replayTimeline';
import { PLAYER_HANDOFF_PAUSE_MS } from './animationTiming';

export { PLAYBACK_TICK_MS } from './animationTiming';

export function computeFrameDwells(frames: Frame[]): number[] {
  const timeline = buildTimeline(frames);
  return timeline.map((beat, i) => {
    let dwell = beat.durationMs;
    // SWU alternates actions, so every change of actor is a real handoff. Linger
    // on the acting player's result before the opponent's action+animations begin.
    const a = beat.actor, b = timeline[i + 1]?.actor;
    if (a && b && a !== b) dwell += PLAYER_HANDOFF_PAUSE_MS;
    return dwell;
  });
}
