// B110: pure planning layer of the FrameAnimator. Given the measured card rects
// of the previous + current frame and the semantic events from frameLog, decide
// WHAT to animate — as a list of typed `Intent`s. No DOM, no WAAPI, no timers →
// fully unit-testable. The animator's executor turns each intent into a clone +
// Web-Animations call; this module owns every "move vs snap vs flip" decision.

import type { FrameCard, AttackEvent, InteractionEvent } from './frameLog';

// A measured card: screen rect + an outerHTML snapshot (for cards that unmount).
export interface Snap { x: number; y: number; w: number; h: number; html: string }
export type Snapshot = Map<string, Snap>;
export interface Point { x: number; y: number }

export type Intent =
  | { type: 'move'; uuid: string; from: Snap; to: Snap; delay: number }
  | { type: 'enter'; uuid: string; delay: number }
  | { type: 'exit'; uuid: string; rect: Snap; delay: number }
  | { type: 'leaderFlip'; uuid: string; from: Snap; to: Snap; delay: number }
  | { type: 'lunge'; uuid: string; from: Snap; to: Snap }
  | { type: 'targetHold'; uuid: string; oldRect: Snap; newRect: Snap }
  | { type: 'tracer'; from: Point; to: Point; color: string }
  | { type: 'flash'; rect: Snap; color: string }
  | { type: 'playFlip'; uuid: string; from: Snap; to: Snap };

export interface PlanInput {
  prev: Snapshot;
  next: Snapshot;
  prevZones: Map<string, string>;          // each card's zone the PREVIOUS frame
  cards: Map<string, FrameCard>;           // this frame's zone + controller per card
  leaders: Set<string>;
  attacks: AttackEvent[];
  interactions: InteractionEvent[];
}

// px of POSITION change to count as a real move (ignores size-only grid reflows).
export const MOVE_THRESHOLD = 8;
const DAMAGE_COLOR = '#ff5a4d';
const HEAL_COLOR = '#46d27a';
const PLAY_ZONES = new Set(['groundArena', 'spaceArena']);
const TRACER_MIN_DIST = 28;

const isArena = (z: string | undefined) => z === 'groundArena' || z === 'spaceArena';
const dist = (a: Snap, b: Snap) => Math.hypot(a.x - b.x, a.y - b.y);
const center = (s: Snap): Point => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 });

export function planFrameAnimations(input: PlanInput): Intent[] {
  const { prev, next, prevZones, cards, leaders, attacks, interactions } = input;
  const intents: Intent[] = [];
  const zoneOf = (u: string) => cards.get(u)?.zone;

  // Sequencing delays park a clone, frozen, at a card's OLD slot for the delay.
  // That's the "clone under the attacker" bug class — but ONLY when something
  // else moves into that slot during the hold. The lunge of an ATTACK does
  // exactly that (a body flies into the target/old slots), so attack frames must
  // NOT hold: they cross-dissolve from t=0 (corpse fading out as the survivor
  // slides in), and the lunge body on top provides the strike read.
  //
  // An INTERACTION (Craving Power et al.) has no body — just a bolt flying to the
  // target. If the board cross-dissolves immediately, the target vanishes and a
  // survivor slides into the impact spot before the bolt lands. So an
  // interaction frame DOES hold the board still until the bolt connects, then
  // dies + reflows. With no lunge in the frame, nothing collides with the parked
  // clones, so the hold is ghost-safe. (A frame with an attack present always
  // cross-dissolves — the lunge would collide with any held clone.)
  const hasAttack = attacks.length > 0;
  const fxHold = interactions.length > 0 && !hasAttack;
  const EXIT_DELAY = fxHold ? 300 : 0;   // corpse fades as the bolt lands (~TRACER_MS)
  const MOVE_DELAY = fxHold ? 540 : 0;   // survivors fill in after the corpse clears
  const LEADER_DELAY = fxHold ? 420 : 0;

  // The lunge OWNS the attacker's visual this frame — even when it trades and
  // dies. So an attacker is skipped by both the move loop AND the exit loop
  // (otherwise a defeated attacker gets a stray fade-out clone lingering at its
  // spot, underneath the lunge and in the path of a survivor sliding in).
  const attackers = new Set(attacks.map((a) => a.attackerUuid));

  // PLAYS: a card played from a hidden hand (opponent) appears as a face-down
  // card EXITING + the real card ENTERING an arena under the same controller.
  // Pair them so the executor can slide + flip instead of fade-out/fade-in.
  const hiddenByCtrl = new Map<string, string[]>();
  for (const u of prev.keys()) {
    if (next.has(u)) continue;
    const m = /^replay-hidden-(.+)-\d+$/.exec(u);
    if (m) { const arr = hiddenByCtrl.get(m[1]) ?? []; arr.push(u); hiddenByCtrl.set(m[1], arr); }
  }
  const plays: { played: string; hidden: string }[] = [];
  const pairedEnter = new Set<string>();
  const pairedExit = new Set<string>();
  for (const u of next.keys()) {
    if (prev.has(u)) continue;
    const info = cards.get(u);
    if (!info || !PLAY_ZONES.has(info.zone) || !info.ctrl) continue;
    const pool = hiddenByCtrl.get(info.ctrl);
    if (pool && pool.length) {
      const hidden = pool.shift()!;
      plays.push({ played: u, hidden });
      pairedEnter.add(u);
      pairedExit.add(hidden);
    }
  }

  // MOVES / ENTERS / LEADER-FLIPS — iterate the new frame's cards.
  for (const [uuid, n] of next) {
    if (attackers.has(uuid)) continue; // the lunge owns the attacker this frame
    const o = prev.get(uuid);
    if (o) {
      const oz = prevZones.get(uuid);
      const nz = zoneOf(uuid);
      // A leader DEPLOY/RETURN crosses the arena↔slot boundary and flips its
      // face. A leader merely reflowing WITHIN the arena keeps its face → falls
      // through to a plain slide.
      if (leaders.has(uuid) && isArena(oz) !== isArena(nz)) {
        if (dist(n, o) > MOVE_THRESHOLD) intents.push({ type: 'leaderFlip', uuid, from: o, to: n, delay: LEADER_DELAY });
        continue;
      }
      // Same-zone reflow in a TRAY zone (hand re-centering, a card lifting as
      // it's selected) → snap. Arena reflows still animate (a survivor sliding
      // into a defeated unit's slot, delayed past the death).
      if (oz && nz && oz === nz && !isArena(nz)) continue;
      if (dist(n, o) <= MOVE_THRESHOLD) continue;
      intents.push({ type: 'move', uuid, from: o, to: n, delay: MOVE_DELAY });
    } else if (!pairedEnter.has(uuid)) {
      intents.push({ type: 'enter', uuid, delay: MOVE_DELAY });
    }
  }

  // EXITS — gone from the new frame.
  for (const [uuid, o] of prev) {
    if (next.has(uuid) || pairedExit.has(uuid) || attackers.has(uuid)) continue;
    intents.push({ type: 'exit', uuid, rect: o, delay: EXIT_DELAY });
  }

  // ATTACKS — lunge the attacker at its target; fall back to the previous frame
  // when a card is gone (defeated target / traded attacker). Hold the target's
  // old look so its damage counter pops on impact (if it survives + sits still).
  for (const { attackerUuid, targetUuid } of attacks) {
    const a = next.get(attackerUuid) ?? prev.get(attackerUuid);
    const t = next.get(targetUuid) ?? prev.get(targetUuid);
    if (!a || !t) continue;
    intents.push({ type: 'lunge', uuid: attackerUuid, from: a, to: t });
    const oldT = prev.get(targetUuid);
    const newT = next.get(targetUuid);
    if (oldT && newT && oldT.html !== newT.html) intents.push({ type: 'targetHold', uuid: targetUuid, oldRect: oldT, newRect: newT });
  }

  // INTERACTIONS — a bolt from the source (or the caster's base, for an event
  // already in discard) to the target, plus an impact flash on the spot it was
  // STRUCK (old position — matters when the hit moves it to discard / the slot).
  for (const { sourceUuid, targetUuid, kind, baseUuid } of interactions) {
    if (sourceUuid === targetUuid || attackers.has(sourceUuid)) continue;
    const t = prev.get(targetUuid) ?? next.get(targetUuid);
    if (!t) continue;
    const color = kind === 'heal' ? HEAL_COLOR : DAMAGE_COLOR;
    const s = next.get(sourceUuid) ?? prev.get(sourceUuid)
      ?? (baseUuid ? (next.get(baseUuid) ?? prev.get(baseUuid)) : undefined);
    if (s) {
      const from = center(s);
      const to = center(t);
      if (Math.hypot(to.x - from.x, to.y - from.y) >= TRACER_MIN_DIST) intents.push({ type: 'tracer', from, to, color });
    }
    intents.push({ type: 'flash', rect: t, color });
  }

  // PLAYS — slide the face-down card to its slot, then flip to the real card.
  for (const { played, hidden } of plays) {
    const from = prev.get(hidden);
    const to = next.get(played);
    if (from && to) intents.push({ type: 'playFlip', uuid: played, from, to });
  }

  return intents;
}
