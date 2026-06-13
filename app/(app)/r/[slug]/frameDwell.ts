// B134/B136: per-frame playback dwell (ms) — how long autoplay / a clip reel
// should sit on each frame so the FrameAnimator's choreography (staged plays,
// resourcing, leader deploy, ambush, attacks) plays out instead of glitching
// past. Shared by the replay viewer's autoplay AND the clip reel player so the
// two always agree. Pure (frames in, ms[] out).
import type { Frame } from '@/lib/replayDecoder';
import { classifyStagedPlays, unitPlayUuids, extractAttacks } from './frameLog';

export const PLAYBACK_TICK_MS = 300;
export const EVENT_PLAY_DWELL_MS = 1600;
export const UPGRADE_PLAY_DWELL_MS = 1450;
export const AMBUSH_PLAY_DWELL_MS = 950;
export const RESOURCE_DWELL_MS = 1450;
export const LEADER_DEPLOY_DWELL_MS = 1800;

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
    if (events) return EVENT_PLAY_DWELL_MS;
    if (upgrades) return UPGRADE_PLAY_DWELL_MS;
    const units = unitPlayUuids(f.state);
    if (units.length && attacksSoon(units, i)) return AMBUSH_PLAY_DWELL_MS;
    if (has(/resourced/i)) return RESOURCE_DWELL_MS;
    if (has(/\bdeploy/i)) return LEADER_DEPLOY_DWELL_MS;
    if (has(/attacks/i)) return 900;
    if (has(/plays /i)) return 720;
    return PLAYBACK_TICK_MS;
  });
}
