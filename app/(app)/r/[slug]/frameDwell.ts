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
  PLAYER_HANDOFF_PAUSE_MS,
} from './animationTiming';

export { PLAYBACK_TICK_MS } from './animationTiming';

// The ACTOR who took a frame's action = the first @player named in its log line
// (e.g. "@madmartigan uses @Cad Bane to deploy …"). Null when the frame has no
// log (a consequence/settle frame). This is the reliable signal — the
// gamestate's `isActionPhaseActivePlayer` flag LAGS by an action (it marks who
// is to move next, so a deploy frame shows the OPPONENT as active).
function logActorOf(state: any): string | null {
  const msgs = state?.newMessages;
  if (!Array.isArray(msgs)) return null;
  for (const m of msgs) {
    const parts = m?.message;
    if (!Array.isArray(parts)) continue;
    const p = parts.find((x: any) => x && typeof x === 'object' && x.type === 'player');
    if (p?.name) return String(p.name);
  }
  return null;
}

// uuid → owning player's USERNAME for every card sitting in an arena (ground or
// space). Arenas live under cardPiles in some payloads and at the player top
// level in others — read both. The username (not the ctrl id) so it lines up
// with logActorOf's @player names.
function arenaOccupants(state: any): Map<string, string> {
  const out = new Map<string, string>();
  for (const pid of Object.keys(state?.players || {})) {
    const player = state.players[pid] || {};
    const name = player?.user?.username || pid;
    const piles = player.cardPiles || {};
    for (const z of ['groundArena', 'spaceArena']) {
      for (const c of piles[z] || []) if (c?.uuid) out.set(c.uuid, name);
      for (const c of player[z] || []) if (c?.uuid) out.set(c.uuid, name);
    }
  }
  return out;
}

// The actor when the LOG is silent: the collapse can strip a play's log line
// (e.g. a unit enters the arena with empty newMessages). A card that NEWLY
// appears in an arena this frame was PLAYED by its controller — a real action,
// so its controller is the actor. Only trust it when a single player's cards
// entered (a token created under the other player as a side effect would make
// it ambiguous — fall back to the log/fill in that case).
function boardActorOf(prev: Map<string, string>, cur: Map<string, string>): string | null {
  const owners = new Set<string>();
  for (const [uuid, owner] of cur) if (!prev.has(uuid)) owners.add(owner);
  return owners.size === 1 ? [...owners][0] : null;
}

// Total resource-pile size across all players (resource cards stay in the pile
// once placed). A growth between frames = a resourcing the planner animates —
// even when the log carries no "resourced" line (e.g. a pilot/plot turn).
function resourcePileTotal(state: any): number {
  let n = 0;
  for (const pid of Object.keys(state?.players || {})) {
    const r = state.players[pid]?.cardPiles?.resources;
    if (Array.isArray(r)) n += r.length;
  }
  return n;
}

export function computeFrameDwells(frames: Frame[]): number[] {
  // Per-frame attacker uuids → detect a unit played-then-attacking (ambush).
  const attackersAt = frames.map((f) => new Set(extractAttacks(f.state).map((a) => a.attackerUuid)));
  const attacksSoon = (uuids: string[], i: number) =>
    uuids.some((u) => attackersAt[i + 1]?.has(u) || attackersAt[i + 2]?.has(u));
  const resourceTotals = frames.map((f) => resourcePileTotal(f.state));

  // Acting player per frame, FORWARD-FILLED so a consequence/settle frame
  // belongs to the action that caused it. The raw signal is the log actor, and
  // when the log is silent (the collapse stripped a play's line) the controller
  // of a unit that newly entered an arena — so a played-but-unlogged unit (the
  // TIE Bomber in cl_qv7v2e) is still attributed to the player who played it,
  // and the handoff to the opponent's next action is detected.
  const arenas = frames.map((f) => arenaOccupants(f.state));
  const activeAt: (string | null)[] = [];
  let held: string | null = null;
  for (let i = 0; i < frames.length; i++) {
    const a = logActorOf(frames[i].state) ?? (i > 0 ? boardActorOf(arenas[i - 1], arenas[i]) : null);
    if (a) held = a;
    activeAt.push(held);
  }

  const baseDwell = (f: Frame, i: number): number => {
    const msgs = (f.state as any)?.newMessages;
    const has = (re: RegExp) => Array.isArray(msgs) && msgs.some((m: any) =>
      Array.isArray(m?.message) && m.message.some((p: any) => typeof p === 'string' && re.test(p)));
    const resourced = has(/resourced/i) || (i > 0 && resourceTotals[i] > resourceTotals[i - 1]);
    const { events, upgrades } = classifyStagedPlays(f.state);
    if (events) return dwellFor(EVENT_TOTAL_MS);
    if (upgrades) return dwellFor(UPGRADE_TOTAL_MS);
    const units = unitPlayUuids(f.state);
    if (units.length && attacksSoon(units, i)) return dwellFor(AMBUSH_TOTAL_MS);
    if (resourced) return dwellFor(RESOURCE_TOTAL_MS);
    if (has(/\bdeploy/i)) return dwellFor(LEADER_DEPLOY_FULL_MS);
    if (has(/attacks/i)) return dwellFor(ATTACK_TOTAL_MS);
    if (has(/plays /i)) return dwellFor(UNIT_PLAY_TOTAL_MS);
    return PLAYBACK_TICK_MS;
  };

  return frames.map((f, i) => {
    let dwell = baseDwell(f, i);
    // Linger on this frame before the NEXT frame hands off to the other player —
    // SWU alternates actions, so every change of actor is a real handoff. Sit on
    // the acting player's result before the opponent's action+animations begin.
    const a = activeAt[i], b = activeAt[i + 1];
    if (a && b && a !== b) dwell += PLAYER_HANDOFF_PAUSE_MS;
    return dwell;
  });
}
