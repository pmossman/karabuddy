// B110: pure planning layer of the FrameAnimator. Given the measured card rects
// of the previous + current frame and the semantic events from frameLog, decide
// WHAT to animate — as a list of typed `Intent`s. No DOM, no WAAPI, no timers →
// fully unit-testable. The animator's executor turns each intent into a clone +
// Web-Animations call; this module owns every "move vs snap vs flip" decision.

import type { FrameCard, AttackEvent, InteractionEvent, EventPlayMsg } from './frameLog';
import { cardImageUrl } from '@/lib/cardImage';

// A measured card: screen rect + an outerHTML snapshot (for cards that unmount).
export interface Snap { x: number; y: number; w: number; h: number; html: string }
export type Snapshot = Map<string, Snap>;
export interface Point { x: number; y: number }

export type Intent =
  | { type: 'move'; uuid: string; from: Snap; to: Snap; delay: number }
  | { type: 'enter'; uuid: string; delay: number }
  | { type: 'exit'; uuid: string; rect: Snap; delay: number }
  | { type: 'leaderFlip'; uuid: string; from: Snap; to: Snap; delay: number }
  // B134: a dramatic leader DEPLOY — raise the leader off the table (grow), hold,
  // flip to its unit side, then bring it down to the board slot (`to`) with a
  // board shake on landing.
  | { type: 'leaderDeploy'; uuid: string; from: Snap; to: Snap; stage: Point }
  | { type: 'lunge'; uuid: string; from: Snap; to: Snap }
  | { type: 'targetHold'; uuid: string; oldRect: Snap; newRect: Snap }
  | { type: 'tracer'; from: Point; to: Point; color: string; delay?: number }
  | { type: 'flash'; rect: Snap; color: string; delay?: number }
  | { type: 'playFlip'; uuid: string; from: Snap; to: Snap }
  // B134: an EVENT play — fly the card out of the hand to a center-stage point
  // (grown, flipped face-up when it came from a hidden hand), hold, then send
  // it to its discard rect. `to` is null when the discard pile doesn't render
  // the card (the clone shrinks out at the stage instead).
  | { type: 'eventStage'; uuid: string; from: Snap; to: Snap | null; faceDown: boolean; stage: Point }
  // B134: an UPGRADE play — fly out of the hand, present above the unit it's
  // attaching to (flipped face-up via `faceUp` art for a hidden-hand play),
  // then tuck under that unit (`unit` rect) handing off to the rendered strip.
  | { type: 'upgradeStage'; uuid: string; from: Snap; unit: Snap; faceDown: boolean; faceUp: string | null; stage: Point }
  // B134: a RESOURCE — a card committed from hand to the resource pile. Grows,
  // pauses, then shrinks into the pile (`pile` rect). A face-up source flips to
  // the cardback (your own / hands-up reveal); a `faceDown` source (the
  // opponent's hidden hand in a normal replay) stays a cardback throughout.
  | { type: 'resourceStage'; uuid: string; from: Snap; pile: Snap; stage: Point; order: number; faceDown: boolean };

export interface PlanInput {
  prev: Snapshot;
  next: Snapshot;
  prevZones: Map<string, string>;          // each card's zone the PREVIOUS frame
  cards: Map<string, FrameCard>;           // this frame's zone + controller per card
  leaders: Set<string>;
  attacks: AttackEvent[];
  interactions: InteractionEvent[];
  // B134: "{player} plays {card}" log events + base ownership (stage point).
  // Optional so older callers/tests don't break.
  eventPlays?: EventPlayMsg[];
  bases?: Map<string, string>;             // base uuid → owning player id
  // B134: resource-pile rects (measured by data-testid) — own + opponent.
  // Destinations for cards committed hand → resources. Null when not rendered.
  resourcePile?: Snap | null;
  resourcePileOpp?: Snap | null;
  // B134: the current POV player id (maps a resourced card's controller to the
  // own vs opponent pile). Null → treat all resourcing as own.
  localPlayerId?: string | null;
  // B134: per-controller resource counts (the opponent's resourced cards are
  // anonymous, so this drives how many hidden cards fly to the opp pile).
  resourceCounts?: Map<string, number>;
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
  const { prev, next, prevZones, cards, leaders, attacks, interactions, eventPlays = [], bases = new Map(), resourcePile = null, resourcePileOpp = null, localPlayerId = null, resourceCounts } = input;
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
  // B134: a staged EVENT (a "plays" card landing in discard) flies out and
  // PRESENTS above the board before its effect resolves. So everything the
  // event DOES — units sliding to discard (defeated), bolts, board shifts —
  // waits until the card has presented + paused. ~the eventStage's arrive
  // (0.26·1500≈390ms) into its hold. Wins over fxHold (longer).
  const hasStagedEvent = eventPlays.some((e) => cards.get(e.uuid)?.zone === 'discard');
  const EVENT_EFFECT_DELAY = 650;
  const EXIT_DELAY = hasStagedEvent ? EVENT_EFFECT_DELAY : (fxHold ? 300 : 0);   // corpse fades as the bolt lands (~TRACER_MS)
  const MOVE_DELAY = hasStagedEvent ? EVENT_EFFECT_DELAY : (fxHold ? 540 : 0);   // survivors fill in after the corpse clears
  const LEADER_DELAY = hasStagedEvent ? EVENT_EFFECT_DELAY : (fxHold ? 420 : 0);
  const FX_DELAY = hasStagedEvent ? EVENT_EFFECT_DELAY : 0; // tracer/flash bolts
  // B134: a unit CREATED on attack (a Spy/Clone token from an on-attack
  // ability) must appear AFTER the strike, not during the lunge — otherwise the
  // token materializes next to the attacker mid-lunge and reads as a ghost
  // clone of it. Delay enters on an attack frame until the strike lands. (Safe:
  // an enter animates the live element in place, so it never parks a clone in
  // the lunge's path — the ghost-clone hazard the hold comments warn about.)
  const ENTER_DELAY = hasAttack ? 360 : MOVE_DELAY;

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

  // B134 STAGED PLAYS: a "plays" log line whose card ends up in DISCARD (an
  // event) or attached to a unit (an upgrade — parentCardId set, in an arena).
  // Both fly out of the hand and present grown at a stage point; the event then
  // drops to its discard rect, the upgrade tucks under its unit. Own-hand plays
  // have a visible prev rect; a hidden hand pairs with an exiting face-down card
  // (same pool as unit plays, which run first). The stage intent OWNS the
  // card's visual this frame, so the move/enter/exit loops below skip it.
  const staged = new Set<string>();
  const stageIntents: Intent[] = [];
  // Base midpoint, biased toward the caster's OPPONENT ("presented" across the
  // table) — the event stage point. Null when bases aren't measurable.
  const baseRects = Array.from(bases.entries())
    .map(([bu, pid]) => ({ pid, rect: next.get(bu) ?? prev.get(bu) }))
    .filter((b): b is { pid: string; rect: Snap } => !!b.rect);
  const baseStage = (ctrl: string | undefined): Point | null => {
    if (baseRects.length !== 2 || !ctrl) return null;
    const opp = baseRects.find((b) => b.pid !== ctrl) ?? baseRects[0];
    const own = baseRects.find((b) => b.pid === ctrl) ?? baseRects[1];
    const oc = center(opp.rect), sc = center(own.rect);
    return { x: sc.x + (oc.x - sc.x) * 0.62, y: sc.y + (oc.y - sc.y) * 0.62 };
  };

  for (const { uuid } of eventPlays) {
    if (staged.has(uuid)) continue;
    const info = cards.get(uuid);
    const z = info?.zone;
    const isEvent = z === 'discard';
    const isUpgrade = !!info?.parentCardId && isArena(z);
    if (!isEvent && !isUpgrade) continue;

    // Resolve the card's STARTING rect: a visible own-hand card, else a paired
    // hidden face-down card (opponent's hand).
    let from = prev.get(uuid);
    let faceDown = false;
    if (from) {
      if (prevZones.get(uuid) !== 'hand') continue; // only a hand departure is a play we choreograph
    } else {
      const pool = info?.ctrl ? hiddenByCtrl.get(info.ctrl) : undefined;
      if (!pool || pool.length === 0) continue;
      const hiddenU = pool.shift()!;
      from = prev.get(hiddenU);
      if (!from) continue;
      pairedExit.add(hiddenU);
      faceDown = true;
    }
    staged.add(uuid);

    if (isUpgrade) {
      // Land target = the unit it attaches to (upgrades render only as a strip
      // under the unit, so they have no own rect). Skip if we can't place it.
      const unit = next.get(info!.parentCardId!) ?? prev.get(info!.parentCardId!);
      if (!unit) { staged.delete(uuid); continue; }
      // Present just above the unit (lifted), then drop in.
      const uc = center(unit);
      const stage: Point = { x: uc.x, y: uc.y - unit.h * 0.7 };
      // Hidden-hand upgrade has no full-card render to flip to → build the
      // face from card art.
      const faceUp = faceDown && info?.setId ? cardImageUrl({ set: info.setId.set, number: info.setId.number }) : null;
      stageIntents.push({ type: 'upgradeStage', uuid, from, unit, faceDown, faceUp, stage });
      continue;
    }

    // Event → drop to its discard rect (null when discard doesn't render it).
    const to = next.get(uuid) ?? null;
    let stage = baseStage(info?.ctrl);
    if (!stage) {
      const fc = center(from), tc = to ? center(to) : fc;
      stage = { x: (fc.x + tc.x) / 2, y: (fc.y + tc.y) / 2 };
    }
    stageIntents.push({ type: 'eventStage', uuid, from, to, faceDown, stage });
  }

  // B134 RESOURCING: a card committed from hand to the resource pile. Only the
  // local player's resourced cards keep a uuid (the opponent's become anonymous
  // pile cards), so detect by the zone transition hand → resources with a
  // visible hand rect. Grows + flips into the pile; the stage owns the card, so
  // the exit loop below skips it (it has no `next` rect — the pile is one box).
  if (resourcePile || resourcePileOpp) {
    // A group of cards resourced together (the two-card opening, or a player's
    // multi-resource) presents SIDE BY SIDE at a shared lineup center, then
    // drops into its pile. The card's own `zone` field is 'resource' (singular);
    // the pile key is 'resources'. extractFrameCards prefers the card field.
    // liftSign: present the cards TOWARD the board interior — up (−1) for the
    // POV player at the bottom, down (+1) for the opponent at the top. (Lifting
    // everything "up" sent the opponent's cards off the top of the board.)
    const emitGroup = (items: { uuid: string; from: Snap }[], pile: Snap | null, faceDown: boolean, liftSign: number) => {
      if (!items.length || !pile) return;
      const pc = center(pile);
      const avgX = items.reduce((s, r) => s + center(r.from).x, 0) / items.length;
      const avgY = items.reduce((s, r) => s + center(r.from).y, 0) / items.length;
      const maxH = Math.max(...items.map((r) => r.from.h));
      const w = items[0].from.w;
      const centerX = (avgX + pc.x) / 2;
      const centerY = avgY + liftSign * maxH * 1.3;
      const spacing = w * 2.0;
      items.forEach((r, i) => {
        const stage: Point = { x: centerX + (i - (items.length - 1) / 2) * spacing, y: centerY };
        stageIntents.push({ type: 'resourceStage', uuid: r.uuid, from: r.from, pile, stage, order: i, faceDown });
      });
    };

    // Pass 1 — VISIBLE resourced cards (real uuid, hand → resource): the POV
    // player's own resourcing, plus the opponent's in a hands-up double-sided
    // replay (their hand is revealed). Split by controller → own vs opp pile;
    // both flip face-up → cardback (we can see them).
    const ownItems: { uuid: string; from: Snap }[] = [];
    const oppItems: { uuid: string; from: Snap }[] = [];
    for (const [uuid, info] of cards) {
      if (staged.has(uuid) || info.zone !== 'resource' || prevZones.get(uuid) !== 'hand') continue;
      const from = prev.get(uuid);
      if (!from) continue;
      staged.add(uuid);
      const isOwn = !localPlayerId || info.ctrl === localPlayerId;
      (isOwn ? ownItems : oppItems).push({ uuid, from });
    }
    emitGroup(ownItems, resourcePile, false, -1);    // POV player: bottom → lift up
    emitGroup(oppItems, resourcePileOpp, false, +1);  // opponent: top → lift down

    // Pass 2 — the OPPONENT's HIDDEN resourcing (normal replay): their hand is
    // face-down, so the resourced cards leave as replay-hidden cards (paired
    // from the same pool as plays, which ran first) and stay cardbacks.
    if (resourcePileOpp && resourceCounts) {
      const oppHidden: { uuid: string; from: Snap }[] = [];
      for (const [ctrl, count] of resourceCounts) {
        if (localPlayerId && ctrl === localPlayerId) continue; // own handled in pass 1
        const pool = hiddenByCtrl.get(ctrl);
        if (!pool) continue;
        for (let taken = 0; taken < count && pool.length; taken++) {
          const hu = pool.shift()!;
          const from = prev.get(hu);
          if (from) { oppHidden.push({ uuid: hu, from }); pairedExit.add(hu); }
        }
      }
      emitGroup(oppHidden, resourcePileOpp, true, +1); // opponent: top → lift down
    }
  }

  // MOVES / ENTERS / LEADER-FLIPS — iterate the new frame's cards.
  for (const [uuid, n] of next) {
    if (attackers.has(uuid)) continue; // the lunge owns the attacker this frame
    if (staged.has(uuid)) continue;    // the eventStage owns a played event
    const o = prev.get(uuid);
    if (o) {
      const oz = prevZones.get(uuid);
      const nz = zoneOf(uuid);
      // A leader DEPLOY/RETURN crosses the arena↔slot boundary and flips its
      // face. A leader merely reflowing WITHIN the arena keeps its face → falls
      // through to a plain slide.
      if (leaders.has(uuid) && isArena(oz) !== isArena(nz)) {
        if (dist(n, o) > MOVE_THRESHOLD) {
          // DEPLOY (slot → arena) gets the dramatic raise-flip-slam; a RETURN
          // (arena → slot) keeps the quick crossfade.
          if (!isArena(oz) && isArena(nz)) {
            // Present lifted toward the board interior — up for the POV player
            // (bottom), down for the opponent (top).
            const liftSign = !localPlayerId || cards.get(uuid)?.ctrl === localPlayerId ? -1 : 1;
            const fc = center(o), tc = center(n);
            const stage: Point = { x: (fc.x + tc.x) / 2, y: (fc.y + tc.y) / 2 + liftSign * Math.max(o.h, n.h) * 1.35 };
            intents.push({ type: 'leaderDeploy', uuid, from: o, to: n, stage });
          } else {
            intents.push({ type: 'leaderFlip', uuid, from: o, to: n, delay: LEADER_DELAY });
          }
        }
        continue;
      }
      // Same-zone reflow in a TRAY zone (hand re-centering, a card lifting as
      // it's selected) → snap. Arena reflows still animate (a survivor sliding
      // into a defeated unit's slot, delayed past the death).
      if (oz && nz && oz === nz && !isArena(nz)) continue;
      if (dist(n, o) <= MOVE_THRESHOLD) continue;
      intents.push({ type: 'move', uuid, from: o, to: n, delay: MOVE_DELAY });
    } else if (!pairedEnter.has(uuid)) {
      intents.push({ type: 'enter', uuid, delay: ENTER_DELAY });
    }
  }

  // EXITS — gone from the new frame.
  for (const [uuid, o] of prev) {
    if (next.has(uuid) || pairedExit.has(uuid) || attackers.has(uuid) || staged.has(uuid)) continue;
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
      if (Math.hypot(to.x - from.x, to.y - from.y) >= TRACER_MIN_DIST) intents.push({ type: 'tracer', from, to, color, delay: FX_DELAY });
    }
    intents.push({ type: 'flash', rect: t, color, delay: FX_DELAY });
  }

  // PLAYS — slide the face-down card to its slot, then flip to the real card.
  for (const { played, hidden } of plays) {
    const from = prev.get(hidden);
    const to = next.get(played);
    if (from && to) intents.push({ type: 'playFlip', uuid: played, from, to });
  }

  intents.push(...stageIntents);
  return intents;
}
