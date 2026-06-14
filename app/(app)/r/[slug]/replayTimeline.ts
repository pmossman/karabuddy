// B147 / ADR 0008: the replay TIMELINE — the single, precomputed, geometry-free
// source of truth for "what animates on each frame, and for how long". One
// classifier (board diff ∪ log) replaces the three that used to re-derive this
// independently (the planner, the dwell, the executors) and drift apart (B141,
// B146). Pure: collapsed frames in, Beat[] out — no DOM, fully unit-testable.
//
// Step 1 of the migration (ADR 0008) wires `frameDwell` to consume this; later
// steps make the planner + renderer consume it too (so they can never drift).
import type { Frame } from '@/lib/replayDecoder';
import { classifyStagedPlays, unitPlayUuids, extractAttacks, extractFrameCards, frameAttacks } from './frameLog';
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

// A geometry-free description of one animation on a frame. `uuid` is carried
// where the board diff knows it (so a future renderer can resolve geometry from
// it); the dwell only needs `kind`.
export type AnimKind = 'leaderDeploy' | 'play' | 'ambush' | 'upgrade' | 'event' | 'resource' | 'attack';
export interface AnimSpec { kind: AnimKind; uuid?: string }

// One frame's worth of the timeline: what animates, how long the longest beat
// runs (incl. the read buffer, or the bare tick when nothing animates), and the
// acting player (forward-filled — used to insert the player-handoff pause).
export interface Beat {
  frameIndex: number;
  anims: AnimSpec[];
  durationMs: number;
  actor: string | null;
}

const ANIM_DURATION_MS: Record<AnimKind, number> = {
  event: EVENT_TOTAL_MS,
  upgrade: UPGRADE_TOTAL_MS,
  ambush: AMBUSH_TOTAL_MS,
  resource: RESOURCE_TOTAL_MS,
  leaderDeploy: LEADER_DEPLOY_FULL_MS,
  attack: ATTACK_TOTAL_MS,
  play: UNIT_PLAY_TOTAL_MS,
};

const isArena = (z?: string) => z === 'groundArena' || z === 'spaceArena';

// ── actor detection (for the player-handoff pause) ─────────────────────────
// The reliable signal is the first @player named in the frame's log; when the
// collapse strips the log, fall back to the controller of a unit that newly
// entered an arena (a played-but-unlogged action). See B146.
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
function boardActorOf(prev: Map<string, string>, cur: Map<string, string>): string | null {
  const owners = new Set<string>();
  for (const [uuid, owner] of cur) if (!prev.has(uuid)) owners.add(owner);
  return owners.size === 1 ? [...owners][0] : null;
}

function resourcePileTotal(state: any): number {
  let n = 0;
  for (const pid of Object.keys(state?.players || {})) {
    const r = state.players[pid]?.cardPiles?.resources;
    if (Array.isArray(r)) n += r.length;
  }
  return n;
}

// THE board-diff signal (ADR 0008 / B146): the animations the renderer will
// actually play, derived from the same board change it animates off — so a
// stripped log can't hide a deploy/play from the dwell.
//   • a LEADER going base → arena      = leader deploy (incl. pilot)
//   • a non-leader newly IN an arena   = a unit play (or an upgrade tuck)

function boardAnims(prevState: any, curState: any): AnimSpec[] {
  const prev = extractFrameCards(prevState);
  const cur = extractFrameCards(curState);
  const out: AnimSpec[] = [];
  for (const u of cur.leaders) {
    const pz = prev.cards.get(u)?.zone;
    const nz = cur.cards.get(u)?.zone;
    if (pz === 'base' && isArena(nz)) out.push({ kind: 'leaderDeploy', uuid: u });
  }
  for (const [u, info] of cur.cards) {
    if (cur.leaders.has(u) || !isArena(info.zone)) continue;     // leaders handled above
    if (isArena(prev.cards.get(u)?.zone)) continue;              // already on board = a move
    out.push({ kind: info.parentCardId ? 'upgrade' : 'play', uuid: u });
  }
  return out;
}

export function buildTimeline(frames: Frame[]): Beat[] {
  const attackersAt = frames.map((f) => new Set(extractAttacks(f.state).map((a) => a.attackerUuid)));
  const attacksSoon = (uuids: string[], i: number) =>
    uuids.some((u) => attackersAt[i + 1]?.has(u) || attackersAt[i + 2]?.has(u));
  const resourceTotals = frames.map((f) => resourcePileTotal(f.state));

  // Forward-filled acting player (a consequence/settle frame belongs to the
  // action that caused it).
  const arenas = frames.map((f) => arenaOccupants(f.state));
  const actors: (string | null)[] = [];
  let held: string | null = null;
  for (let i = 0; i < frames.length; i++) {
    const a = logActorOf(frames[i].state) ?? (i > 0 ? boardActorOf(arenas[i - 1], arenas[i]) : null);
    if (a) held = a;
    actors.push(held);
  }

  return frames.map((f, i) => {
    const msgs = (f.state as any)?.newMessages;
    const has = (re: RegExp) => Array.isArray(msgs) && msgs.some((m: any) =>
      Array.isArray(m?.message) && m.message.some((p: any) => typeof p === 'string' && re.test(p)));

    const anims: AnimSpec[] = [];
    // ── log-based signals ──
    const { events, upgrades } = classifyStagedPlays(f.state);
    if (events) anims.push({ kind: 'event' });
    if (upgrades) anims.push({ kind: 'upgrade' });
    const units = unitPlayUuids(f.state);
    if (units.length) anims.push({ kind: attacksSoon(units, i) ? 'ambush' : 'play' });
    if (has(/resourced/i) || (i > 0 && resourceTotals[i] > resourceTotals[i - 1])) anims.push({ kind: 'resource' });
    if (has(/\bdeploy/i)) anims.push({ kind: 'leaderDeploy' });
    if (has(/plays /i)) anims.push({ kind: 'play' });
    // ── board-diff signals (robust to a stripped log) ──
    if (i > 0) anims.push(...boardAnims(frames[i - 1].state, f.state));
    // ADR 0008 step 2d: attacks come from the ONE classifier the renderer also
    // uses (frameAttacks: log + isAttacker flag + exhaust/damage fallback), so the
    // dwell budgets exactly the lunges the planner produces — they can't drift.
    for (const a of i > 0 ? frameAttacks(frames[i - 1].state, f.state) : [])
      anims.push({ kind: 'attack', uuid: a.attackerUuid });

    // The dwell must outlast the LONGEST animation on the frame (the max, not a
    // priority-pick, so concurrent beats — deploy + attack — budget the longer).
    const maxAnim = anims.reduce((m, a) => Math.max(m, ANIM_DURATION_MS[a.kind]), 0);
    return {
      frameIndex: i,
      anims,
      durationMs: maxAnim > 0 ? dwellFor(maxAnim) : PLAYBACK_TICK_MS,
      actor: actors[i],
    };
  });
}
