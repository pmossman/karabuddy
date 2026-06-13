'use client';

import { useEffect, useRef } from 'react';
import { useGame } from '@/app/_contexts/Game.context';
import type { Frame } from '@/lib/replayDecoder';

// ── Playback speed (single source of truth) ────────────────────────────────
// Literal multipliers, consistent everywhere (replay viewer, clip reel, clip
// builder): 1× is the natural pace (animations play at their real duration and
// each frame dwells for animationTotal + buffer), 2× is exactly twice as fast,
// 0.5× exactly half. The multiplier scales BOTH the dwell (createDwellStepper)
// AND the animations (FrameAnimator playbackRate), so they always stay in step.
export const PLAYBACK_SPEEDS: ReadonlyArray<{ label: string; value: number }> = [
  { label: '0.5×', value: 0.5 },
  { label: '1×', value: 1 },
  { label: '2×', value: 2 },
];
export const PLAYBACK_SPEED_DEFAULT = 1;
export const PLAYBACK_SPEED_STORAGE_KEY = 'karabuddy:playbackSpeed';

// ── Shared autoplay cadence ────────────────────────────────────────────────
// ONE stepping engine for the replay viewer's autoplay AND the clip reel. Both
// must dwell on each frame for its choreography length so animations finish;
// the displayed frame is threaded as a LOCAL through the recursion (reading a
// React ref right after setState returns the stale pre-render value, which
// dwelled each frame for its predecessor's dwell and clipped animations). The
// two surfaces differ ONLY in config — loop vs stop-at-end, range bounds, and
// per-frame side effects — never in the timing logic.
export interface DwellStepperConfig {
  isPlaying: () => boolean;          // gate — stop rescheduling when false
  speed: () => number;               // live playback-speed multiplier
  minDwellMs: number;                // floor per step (0 = no floor)
  dwellMs: (frame: number) => number; // choreography dwell for DISPLAYING `frame`
  lower: () => number;               // first playable frame
  upper: () => number;               // last playable frame
  loop: boolean;                     // at `upper`: loop to `lower`, else stop
  show: (frame: number, ctx: { looped: boolean }) => void; // commit the displayed frame
  onFrame?: (frame: number, dwellMs: number) => void;      // per displayed frame (e.g. a progress segment)
  onEnd?: () => void;                // reached `upper` with loop=false
}

export interface DwellStepper {
  start: (from: number) => void; // (re)start stepping from a displayed frame
  stop: () => void;
}

export function createDwellStepper(cfg: DwellStepperConfig): DwellStepper {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => { if (timer != null) { clearTimeout(timer); timer = null; } };
  const step = (cur: number) => {
    clear();
    if (!cfg.isPlaying()) return;
    const dwell = Math.max(cfg.minDwellMs, (cfg.dwellMs(cur) || 0) / (cfg.speed() || 1));
    cfg.onFrame?.(cur, dwell);
    timer = setTimeout(() => {
      if (!cfg.isPlaying()) return;
      if (cur >= cfg.upper()) {
        if (cfg.loop) { const lo = cfg.lower(); cfg.show(lo, { looped: true }); step(lo); }
        else cfg.onEnd?.();
        return;
      }
      const next = cur + 1;
      cfg.show(next, { looped: false });
      step(next);
    }, dwell);
  };
  return { start: (from) => step(from), stop: clear };
}

// B138: ONE source of truth for replay/clip board playback. The replay viewer
// and the clip surfaces (reel player + builder preview) must orient the board
// and push frames identically — otherwise the same payload renders flipped in
// one and not the other (which inverts the FrameAnimator's geometry, sending
// resourced cards off-screen and squashing deploy animations).
//
// Board ORIENTATION = the recorder's captured POV (the decoded payload's
// `meta.localPlayerId`) when present, else the first player. It is ALWAYS the
// recorder's side — anonymization swaps usernames, not which side is "yours".
export function resolveConnectedPlayer(
  players: Record<string, unknown> | null | undefined,
  metaLocalPlayerId: string | null | undefined,
): string | null {
  if (!players) return null;
  if (metaLocalPlayerId && Object.prototype.hasOwnProperty.call(players, metaLocalPlayerId)) return metaLocalPlayerId;
  return Object.keys(players)[0] ?? null;
}

// Drive an independent board (mounted inside a nested GameProvider) from a frame
// index: set the POV once, then push each frame — animating a forward single
// step and SNAPPING (via skipNextRef) on a scrub / backward / multi-frame jump,
// exactly as the replay viewer does. Returns a live direction ref for the
// FrameAnimator. Shared by ClipPlayer and ClipBoardPreview.
export function usePlaybackBoard({
  frames,
  metaLocalPlayerId,
  index,
  animate,
  skipNextRef,
}: {
  frames: Frame[];
  metaLocalPlayerId: string | null;
  index: number;
  animate: boolean;
  skipNextRef: React.MutableRefObject<boolean>;
}) {
  const { setGameState, setConnectedPlayer } = useGame();
  const dirRef = useRef(1);
  const prevIdx = useRef(index);

  useEffect(() => {
    const connected = resolveConnectedPlayer(frames[0]?.state?.players, metaLocalPlayerId);
    if (connected) setConnectedPlayer(connected);
  }, [frames, metaLocalPlayerId, setConnectedPlayer]);

  useEffect(() => {
    const i = Math.max(0, Math.min(frames.length - 1, index));
    const delta = i - prevIdx.current;
    dirRef.current = delta >= 0 ? 1 : -1;
    if (!animate || delta <= 0 || delta > 1) skipNextRef.current = true;
    prevIdx.current = i;
    const f = frames[i];
    if (f?.state) setGameState(f.state);
  }, [frames, index, animate, setGameState, skipNextRef]);

  return dirRef;
}
