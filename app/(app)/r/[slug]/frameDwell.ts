// B134/B136/B138: per-frame playback dwell (ms) — how long autoplay / a clip
// reel should sit on each frame so the FrameAnimator's choreography (staged
// plays, resourcing, leader deploy, ambush, attacks) plays out instead of
// glitching past. Shared by the replay viewer's autoplay AND the clip reel
// player so the two always agree. Pure (frames in, ms[] out).
//
// The dwell for each beat is derived from the SAME animation durations the
// FrameAnimator uses (animationTiming.ts) + a read buffer, so a frame can never
// advance before its animation finishes at 1×. See animationTiming for why.
import type { Frame } from '@/lib/replayDecoder';
import { classifyStagedPlays, unitPlayUuids, extractAttacks } from './frameLog';
import {
  PLAYBACK_TICK_MS,
  EVENT_TOTAL_MS,
  UPGRADE_TOTAL_MS,
  AMBUSH_TOTAL_MS,
  RESOURCE_TOTAL_MS,
  LEADER_DEPLOY_FULL_MS,
  ATTACK_TOTAL_MS,
  UNIT_PLAY_TOTAL_MS,
  dwellFor,
} from './animationTiming';

export { PLAYBACK_TICK_MS } from './animationTiming';

export function computeFrameDwells(frames: Frame[]): number[] {
  // Per-frame attacker uuids → detect a unit played-then-attacking (ambush).
  const attackersAt = frames.map((f) => new Set(extractAttacks(f.state).map((a) => a.attackerUuid)));
  const attacksSoon = (uuids: string[], i: number) =>
    uuids.some((u) => attackersAt[i + 1]?.has(u) || attackersAt[i + 2]?.has(u));
  return frames.map((f, i) => {
    const msgs = (f.state as any)?.newMessages;
    const has = (re: RegExp) => Array.isArray(msgs) && msgs.some((m: any) =>
      Array.isArray(m?.message) && m.message.some((p: any) => typeof p === 'string' && re.test(p)));
    const { events, upgrades } = classifyStagedPlays(f.state);
    if (events) return dwellFor(EVENT_TOTAL_MS);
    if (upgrades) return dwellFor(UPGRADE_TOTAL_MS);
    const units = unitPlayUuids(f.state);
    if (units.length && attacksSoon(units, i)) return dwellFor(AMBUSH_TOTAL_MS);
    if (has(/resourced/i)) return dwellFor(RESOURCE_TOTAL_MS);
    if (has(/\bdeploy/i)) return dwellFor(LEADER_DEPLOY_FULL_MS);
    if (has(/attacks/i)) return dwellFor(ATTACK_TOTAL_MS);
    if (has(/plays /i)) return dwellFor(UNIT_PLAY_TOTAL_MS);
    return PLAYBACK_TICK_MS;
  });
}
