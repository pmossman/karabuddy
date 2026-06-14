'use client';

import { useLayoutEffect, useRef } from 'react';
import { useGame } from '@/app/_contexts/Game.context';
import { extractFrameCards, extractAttacks, extractInteractions, extractEventPlays, extractBases, extractResourceCounts } from './frameLog';
import { planFrameAnimations, type Snap, type Snapshot, type Intent } from './frameAnimationPlan';
import { createBoardGeometry } from './boardGeometry';
import { slide, enterFade, exitFade, playFlip } from './animPrimitives';
// B138: animation durations live in one shared module so the autoplay/clip
// dwell (frameDwell.ts) is derived from the SAME numbers — see animationTiming.
import {
  RAPID_STEP_MS, DURATION, LUNGE_MS, TRACER_MS, PLAY_MOVE_MS, PLAY_FLIP_MS,
  EVENT_TOTAL_MS, EVENT_FLIP_MS, EVENT_FLIP_DELAY, UPGRADE_TOTAL_MS,
  RESOURCE_RISE_MS, RESOURCE_HOLD_MS, RESOURCE_DROP_MS, RESOURCE_TOTAL_MS,
  LEADER_DEPLOY_RISE_MS, LEADER_DEPLOY_HOLD_MS, LEADER_DEPLOY_DESCEND_MS, LEADER_DEPLOY_TOTAL,
  VIGNETTE_LINGER_MS,
} from './animationTiming';

// B104/B109/B110: animate card movement between replay frames. Cards carry a
// stable `uuid` across frames + zones, and the lifted board tags each DOM node
// with `data-card-uuid`. On each frame change this effect:
//   1. measures every card's screen rect by uuid (the only DOM READ),
//   2. parses semantic events from the log (frameLog — pure),
//   3. PLANS what to animate as typed Intents (frameAnimationPlan — pure),
//   4. EXECUTES each intent as a Web-Animations clone (runIntent — imperative).
// Overlay-based (clones in an absolute layer over the board) so we don't thread
// FLIP refs through every zone component. Driven off the game context's
// `gameState` so the effect runs AFTER the board re-renders the new frame.

// Animator-internal shape constants (easings, stage scales, and offset ratios).
// The raw ms durations are imported from ./animationTiming (shared with the
// dwell map); the ratios below are derived from those same durations.
const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
const LUNGE_EASING = 'cubic-bezier(0.34, 1.2, 0.64, 1)';
// Event-play choreography offsets — fly out, hold at the stage point, drop away.
const EVENT_ARRIVE = 0.26;   // offset: at the stage point
const EVENT_DEPART = 0.74;   // offset: leaves the stage point
const EVENT_STAGE_SCALE = 2.1;
// Upgrade choreography — present above the unit, then tuck under it.
const UPGRADE_ARRIVE = 0.28;
const UPGRADE_DEPART = 0.66;
const UPGRADE_STAGE_SCALE = 1.7;
// Resourcing — rise + grow (face up), HOLD to read, then flip + drop. The
// arrive/depart offsets are the phase boundaries within RESOURCE_TOTAL_MS.
const RESOURCE_ARRIVE = RESOURCE_RISE_MS / RESOURCE_TOTAL_MS;
const RESOURCE_DEPART = (RESOURCE_RISE_MS + RESOURCE_HOLD_MS) / RESOURCE_TOTAL_MS;
const RESOURCE_STAGE_SCALE = 1.65;
// The board's default cardback — resources go face-DOWN into the pile. Same
// asset the lifted board uses (getCardback default), rendered `contain`.
const CARDBACK_URL = '/card-back.png';
// Dramatic leader deploy — raise (grow), hold, flip to the unit side, slam down.
const LEADER_DEPLOY_SCALE = 2.3;

export function FrameAnimator({
  containerRef,
  enabled,
  direction,
  skipNextRef,
  localPlayerId,
  speedRef,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  enabled: boolean;
  // B138: live playback-speed multiplier. Every animation's playbackRate is set
  // to this so animations run faster/slower IN STEP with the dwell — never cut
  // off or skipped at higher speeds. A ref so changing speed doesn't re-run the
  // effect (which would re-trigger animations). Defaults to 1× when absent.
  speedRef?: React.RefObject<number | null>;
  // B134: the current POV player id — maps a resourced card's controller to the
  // own vs opponent resource pile.
  localPlayerId?: string | null;
  // +1 stepping forward, -1 stepping backward. Animations are forward-only: they
  // visualize the transition INTO the new frame (read from its log), which only
  // matches the motion going forward. Rewinding, we snap — the new frame's
  // layout also can't be measured reliably mid-rewind (a re-entering card reflows
  // the row after we read it). See the backward branch in the effect.
  direction: number;
  // B128: one-shot suppression. The POV-swap (flip) render re-renders the SAME
  // card uuids at mirrored positions — FLIPping that would animate bases/leaders
  // flying across the board (outliving the handoff curtain). The viewer sets
  // this just before swapping; we consume it and snap instead.
  skipNextRef?: React.MutableRefObject<boolean>;
}) {
  const { gameState } = useGame();
  const overlayRef = useRef<HTMLDivElement>(null);
  const dirRef = useRef(1);
  dirRef.current = direction;
  const prev = useRef<Snapshot | null>(null);
  // In-flight animations + cards we've hidden, so a fast step can cancel/restore.
  const active = useRef<Animation[]>([]);
  const hidden = useRef<HTMLElement[]>([]);
  // B141: freshly-played upgrade strips hidden (via injected CSS) BEFORE measure,
  // keyed by upgrade uuid, so the host unit + siblings don't measure/animate the
  // cell growth the strip causes. The deploy executor reveals each as it tucks.
  const upgHidden = useRef<Map<string, { style: HTMLStyleElement; timer: number | null }>>(new Map());
  const lastRun = useRef(0); // timestamp of the last frame change (rapid-step detection)
  const zones = useRef<Map<string, string>>(new Map()); // uuid → zone, previous frame
  const baseDamage = useRef<Map<string, number>>(new Map()); // base uuid → damage, previous frame
  const remeasureRaf = useRef<number | null>(null); // deferred settle-measure after a backward snap

  useLayoutEffect(() => {
    const container = containerRef.current;
    const overlay = overlayRef.current;
    if (!container || !overlay) return;

    // B147 / ADR 0008: all board-position reads go through the geometry seam.
    const geom = createBoardGeometry(container);
    const measure = geom.measureAll;

    // Cancel anything still running, un-hide cards from the last step, and remove
    // leftover clones — BEFORE measuring, so measure() only ever sees real board
    // cards (clones carry the same data-card-uuid and would be picked up). Also
    // drop any pending settle-measure from a prior backward step (this run will
    // set prev.current itself).
    active.current.forEach((a) => a.cancel());
    active.current = [];
    hidden.current.forEach((el) => { el.style.opacity = ''; });
    hidden.current = [];
    upgHidden.current.forEach((e) => { if (e.timer != null) clearTimeout(e.timer); e.style.remove(); });
    upgHidden.current.clear();
    overlay.replaceChildren();
    if (remeasureRaf.current != null) { cancelAnimationFrame(remeasureRaf.current); remeasureRaf.current = null; }

    const now = performance.now();
    const dt = now - lastRun.current;
    lastRun.current = now;
    // B139: track each base's damage so we can shake it by the damage DEALT this
    // frame (the delta). Capture prev, refresh the ref now — so snaps/scrubs keep
    // it current and only a real forward step (below) shakes.
    const prevBaseDmg = baseDamage.current;
    const curBaseDmg = new Map<string, number>();
    for (const pid of Object.keys(gameState?.players || {})) {
      const b = gameState.players[pid]?.base;
      if (b?.uuid) curBaseDmg.set(b.uuid, typeof b.damage === 'number' ? b.damage : 0);
    }
    baseDamage.current = curBaseDmg;
    // B128: a POV swap render — snap, exactly like the rapid-step path (the
    // next real step re-measures from the settled mirrored layout).
    if (skipNextRef?.current) { skipNextRef.current = false; prev.current = null; return; }
    if (!enabled || dt < RAPID_STEP_MS) { prev.current = null; return; }

    // Per-card zone this frame (kept in sync with `prev`). Comparing to the
    // previous frame's zones lets the planner tell a real cross-zone move from a
    // same-zone reflow, and a leader deploy/return from an arena reflow. Read it
    // BEFORE measuring: a freshly-attached upgrade strip (a pilot leader, or a
    // played upgrade landing on a unit) GROWS its host unit's cell, which reflows
    // the arena and would animate the host + its siblings sliding — with a black
    // bar in the reserved strip slot. Hide those strips first so measure() sees
    // the settled, pre-strip layout; the deploy executor reveals each as it tucks.
    const { cards, leaders } = extractFrameCards(gameState);
    const prevZones = zones.current;
    const isArenaZone = (z?: string) => z === 'groundArena' || z === 'spaceArena';
    for (const [u, c] of cards) {
      if (c.parentCardId && isArenaZone(c.zone) && prevZones.get(u) !== c.zone && !upgHidden.current.has(u)) {
        const style = document.createElement('style');
        style.textContent = `[data-upgrade-uuid="${cssEscape(u)}"]{display:none!important}`;
        document.head.appendChild(style);
        upgHidden.current.set(u, { style, timer: null });
      }
    }

    const next = measure();
    const old = prev.current;
    // `next` is measured with fresh upgrade strips hidden, so THIS frame doesn't
    // animate the host unit + siblings growing into the strip. But the frame
    // SETTLES with the strips shown (revealed at descent), so prev.current — the
    // baseline the NEXT frame diffs against — must be the SETTLED layout; else
    // the next frame sees the host "grow" into the strip again and bounces.
    // Briefly drop the hides, measure settled, then re-hide — all before paint.
    if (upgHidden.current.size) {
      const styles = [...upgHidden.current.values()].map((e) => e.style);
      styles.forEach((s) => s.remove());
      prev.current = measure();
      styles.forEach((s) => document.head.appendChild(s));
    } else {
      prev.current = next;
    }

    const nextZones = new Map<string, string>();
    for (const [u, c] of cards) nextZones.set(u, c.zone);
    zones.current = nextZones;

    // Backward step = rewind. Don't animate, and DON'T trust this measurement:
    // when a card re-enters going back, the board reflows the row AFTER we read
    // it here, so the destinations we'd slide clones to are stale (→ a ghost
    // clone parked at a wrong slot, which also poisons prev.current for the next
    // forward step). Snap instead, then re-measure the SETTLED layout on the next
    // frame so the following forward step animates from correct positions.
    const revealAllUpg = () => {
      upgHidden.current.forEach((e) => { if (e.timer != null) clearTimeout(e.timer); e.style.remove(); });
      upgHidden.current.clear();
    };
    if (dirRef.current < 0) {
      revealAllUpg();
      remeasureRaf.current = requestAnimationFrame(() => { remeasureRaf.current = null; prev.current = measure(); });
      return;
    }

    if (!old) { revealAllUpg(); return; }

    const intents = planFrameAnimations({
      prev: old,
      next,
      prevZones,
      cards,
      leaders,
      attacks: extractAttacks(gameState),
      interactions: extractInteractions(gameState),
      eventPlays: extractEventPlays(gameState),
      bases: extractBases(gameState),
      resourcePile: geom.resourcePile('mine'),
      resourcePileOpp: geom.resourcePile('opp'),
      localPlayerId,
      resourceCounts: extractResourceCounts(gameState),
    });

    // ----- Execute -----
    // B138: scale every animation by the live playback speed so it finishes IN
    // STEP with the (also speed-scaled) dwell — 2× plays the choreography twice
    // as fast, 0.5× half as fast, and nothing is ever cut off or skipped.
    const rate = Math.max(0.05, speedRef?.current ?? 1);
    const cRect = container.getBoundingClientRect();
    const ctx: Ctx = {
      overlay,
      container,
      cRect,
      rate,
      rel: (s) => ({ left: s.x - cRect.left, top: s.y - cRect.top }),
      findCard: (uuid) => container.querySelector<HTMLElement>(`[data-card-uuid="${cssEscape(uuid)}"]`),
      clone: (snap, zIndex) => {
        const el = makeClone(snap.html, { left: snap.x - cRect.left, top: snap.y - cRect.top }, snap.w, snap.h);
        if (zIndex != null) el.style.zIndex = String(zIndex);
        overlay.appendChild(el);
        return el;
      },
      fit: (html) => fitNode(html),
      layer: (snap, opts) => {
        const outer = document.createElement('div');
        Object.assign(outer.style, {
          position: 'absolute', left: `${snap.x - cRect.left}px`, top: `${snap.y - cRect.top}px`,
          width: `${snap.w}px`, height: `${snap.h}px`, transformOrigin: opts.origin ?? 'center',
          pointerEvents: 'none', zIndex: String(opts.zIndex),
        } as CSSStyleDeclaration);
        const inner = document.createElement('div');
        Object.assign(inner.style, {
          width: '100%', height: '100%', position: 'relative', transformOrigin: 'center',
          ...(opts.shadow ? { filter: opts.shadow } : {}),
        } as CSSStyleDeclaration);
        outer.appendChild(inner);
        overlay.appendChild(outer);
        return { outer, inner };
      },
      track: (anim, onDone) => {
        if (!anim) { onDone?.(); return; }
        anim.playbackRate = rate; // playbackRate scales delay + duration together
        active.current.push(anim);
        anim.onfinish = anim.oncancel = () => { onDone?.(); };
      },
      hide: (el) => { if (el) { el.style.opacity = '0'; hidden.current.push(el); } },
      show: (el) => { if (el) el.style.opacity = ''; },
      upgHidden: upgHidden.current,
    };
    for (const intent of intents) runIntent(intent, ctx);
    // Any pre-hidden upgrade strip NOT claimed by a deploy/upgrade executor (no
    // reveal timer scheduled) wasn't actually animated this frame — show it now.
    upgHidden.current.forEach((e, u) => { if (e.timer == null) { e.style.remove(); upgHidden.current.delete(u); } });

    // B139: a base that took damage this frame shakes, harder the more it took.
    // We shake a CLONE in the overlay (and hide the real base underneath) —
    // transforming the live base in the board DOM didn't move it visually. Same
    // proven pattern as the leader-deploy / event choreography.
    for (const [uuid, dmg] of curBaseDmg) {
      const before = prevBaseDmg.get(uuid);
      if (before == null) continue; // not tracked last frame (first frame / scrub)
      const dealt = dmg - before;
      if (dealt <= 0) continue;
      const snap = next.get(uuid);
      const realEl = ctx.findCard(uuid);
      if (!snap || !realEl) continue;
      const p = ctx.rel(snap);
      const clone = document.createElement('div');
      Object.assign(clone.style, {
        position: 'absolute', left: `${p.left}px`, top: `${p.top}px`,
        width: `${snap.w}px`, height: `${snap.h}px`,
        pointerEvents: 'none', zIndex: '8', transformOrigin: 'center',
      } as CSSStyleDeclaration);
      clone.appendChild(fitNode(snap.html));
      overlay.appendChild(clone);
      ctx.hide(realEl);
      ctx.track(shakeCard(clone, dealt), () => { clone.remove(); ctx.show(realEl); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState, enabled, localPlayerId]);

  return (
    <div
      ref={overlayRef}
      aria-hidden
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 4 }}
    />
  );
}

interface Ctx {
  overlay: HTMLElement;
  container: HTMLElement;
  cRect: DOMRect;
  rate: number; // playback-speed multiplier; scales swap timeouts (track scales the animations)
  rel: (s: { x: number; y: number }) => { left: number; top: number };
  findCard: (uuid: string) => HTMLElement | null;
  // B147: the Stage's clone factories (overlay clone, fill-parent face, two-layer
  // outer/inner) used by the migrated primitives.
  clone: (snap: Snap, zIndex?: number) => HTMLElement;
  fit: (html: string) => HTMLElement;
  layer: (snap: Snap, opts: { zIndex: number; origin?: string; shadow?: string }) => { outer: HTMLElement; inner: HTMLElement };
  track: (anim: Animation | null, onDone?: () => void) => void;
  hide: (el: HTMLElement | null) => void;
  show: (el: HTMLElement | null) => void;
  upgHidden: Map<string, { style: HTMLStyleElement; timer: number | null }>;
}

// Turn one planned Intent into clones + Web-Animations calls. The "what" lives
// in the planner; this is only the "how" (geometry → keyframes). Each clone sets
// its start transform/opacity INLINE before the first paint so a delayed
// animation never flashes at its natural rect (fill:'backwards' alone can let
// one frame through); fill:'both' holds the end until the clone is removed.
function runIntent(intent: Intent, ctx: Ctx): void {
  const { overlay, rel, findCard, track, hide, show, rate, upgHidden } = ctx;
  switch (intent.type) {
    case 'move':
      // B147 / ADR 0008: first kind migrated onto the primitive vocabulary.
      slide(ctx, { uuid: intent.uuid, from: intent.from, to: intent.to, delay: intent.delay });
      return;
    case 'enter':
      enterFade(ctx, { uuid: intent.uuid, delay: intent.delay });
      return;
    case 'exit':
      exitFade(ctx, { from: intent.rect, delay: intent.delay });
      return;
    case 'leaderFlip': {
      // Crossfade between the two faces, each at its OWN natural size (rendering
      // one face's art in the other's box is what stretched it). The unit side
      // holds at its struck spot for the bolt/lunge, retreats + fades; the leader
      // side flips in at the slot.
      const { uuid, from: o, to: n, delay } = intent;
      const liveEl = findCard(uuid);
      hide(liveEl);
      const dx = (n.x + n.w / 2) - (o.x + o.w / 2);
      const dy = (n.y + n.h / 2) - (o.y + o.h / 2);
      const uClone = makeClone(o.html, rel(o), o.w, o.h);
      uClone.style.zIndex = '8';
      overlay.appendChild(uClone);
      track(
        uClone.animate(
          [{ transform: 'translate(0,0) scale(1)', opacity: 1, offset: 0 },
           { transform: `translate(${dx * 0.75}px, ${dy * 0.75}px) scale(0.72)`, opacity: 0, offset: 1 }],
          { duration: 320, delay, fill: 'backwards', easing: EASING }),
        () => uClone.remove(),
      );
      const lClone = makeClone(n.html, rel(n), n.w, n.h);
      lClone.style.zIndex = '8';
      lClone.style.transformOrigin = 'center';
      lClone.style.transform = 'scaleX(0.04)'; lClone.style.opacity = '0';
      overlay.appendChild(lClone);
      track(
        lClone.animate([{ transform: 'scaleX(0.04)', opacity: 0.5, offset: 0 }, { transform: 'scaleX(1)', opacity: 1, offset: 1 }],
          { duration: 240, delay: delay + 200, fill: 'both', easing: 'ease-out' }),
        () => { lClone.remove(); show(liveEl); },
      );
      return;
    }
    case 'lunge': {
      const { uuid, from: a, to: t } = intent;
      const dx = (t.x + t.w / 2 - (a.x + a.w / 2)) * 0.55;
      const dy = (t.y + t.h / 2 - (a.y + a.h / 2)) * 0.55;
      const kf = [
        { transform: 'translate(0,0) scale(1)', offset: 0 },
        { transform: `translate(${dx}px, ${dy}px) scale(1.08)`, offset: 0.42 },
        { transform: 'translate(0,0) scale(1)', offset: 1 },
      ];
      const liveEl = findCard(uuid);
      if (liveEl) {
        // B134: a SURVIVING attacker lunges as the LIVE element. The old path
        // cloned it + hid the original, but the original could stay visible — a
        // stationary "clone" left behind while the lunge flew out. Animating the
        // element itself can't diverge from itself. (Same trick as 'enter';
        // WAAPI reverts the transform on finish/cancel, so no residue.)
        const pz = liveEl.style.zIndex, pp = liveEl.style.position;
        if (!liveEl.style.position) liveEl.style.position = 'relative';
        liveEl.style.zIndex = '20'; // above its row-mates during the traversal
        // The unit board clips with overflow:hidden, so a leader lunging across
        // the board to a base would be cut off. Temporarily un-clip the
        // ancestors (up to the board container) for the traversal — the overlay
        // clone path didn't need this because it lives outside the clip.
        const unclipped = unclipAncestors(liveEl, ctx.container);
        track(
          liveEl.animate(kf, { duration: LUNGE_MS, easing: LUNGE_EASING }),
          () => { liveEl.style.zIndex = pz; liveEl.style.position = pp; unclipped(); },
        );
      } else {
        // Attacker traded away (gone from the board) → clone its last look.
        const clone = makeClone(a.html, rel(a), a.w, a.h);
        clone.style.zIndex = '10';
        overlay.appendChild(clone);
        track(clone.animate(kf, { duration: LUNGE_MS, easing: LUNGE_EASING }), () => clone.remove());
      }
      return;
    }
    case 'targetHold': {
      // Hold the target's OLD look over the real card until the lunge connects,
      // so its damage counter pops on impact rather than before.
      const { uuid, oldRect, newRect } = intent;
      const tEl = findCard(uuid);
      const tClone = makeClone(oldRect.html, rel(newRect), newRect.w, newRect.h);
      overlay.appendChild(tClone);
      hide(tEl);
      track(tClone.animate([{ opacity: 1 }, { opacity: 1 }], { duration: 230 }), () => { tClone.remove(); show(tEl); });
      return;
    }
    case 'tracer': {
      const { from, to, color } = intent;
      const size = 16;
      const orb = document.createElement('div');
      Object.assign(orb.style, {
        position: 'absolute', left: `${from.x - ctx.cRect.left - size / 2}px`, top: `${from.y - ctx.cRect.top - size / 2}px`,
        width: `${size}px`, height: `${size}px`, borderRadius: '50%',
        // Invisible until the animation begins — matters when delayed (B134),
        // so the orb doesn't sit lit at its origin during the wait.
        opacity: '0',
        background: color, boxShadow: `0 0 10px 3px ${color}`, pointerEvents: 'none', zIndex: '11',
      } as CSSStyleDeclaration);
      overlay.appendChild(orb);
      const dx = to.x - from.x, dy = to.y - from.y;
      track(
        orb.animate(
          [{ transform: 'translate(0,0) scale(0.5)', opacity: 0.3, offset: 0 },
           { transform: `translate(${dx * 0.5}px, ${dy * 0.5}px) scale(1)`, opacity: 1, offset: 0.5 },
           { transform: `translate(${dx}px, ${dy}px) scale(1.4)`, opacity: 1, offset: 1 }],
          // B134: delay (event effect) holds the bolt until the card presents.
          { duration: TRACER_MS, delay: intent.delay ?? 0, easing: 'cubic-bezier(0.4, 0, 0.6, 1)' }),
        () => orb.remove(),
      );
      return;
    }
    case 'flash': {
      const { rect: t, color } = intent;
      const fp = rel(t);
      const flash = document.createElement('div');
      Object.assign(flash.style, {
        position: 'absolute', left: `${fp.left}px`, top: `${fp.top}px`, width: `${t.w}px`, height: `${t.h}px`,
        borderRadius: '7px', background: color, opacity: '0', pointerEvents: 'none', zIndex: '9', mixBlendMode: 'screen',
      } as CSSStyleDeclaration);
      overlay.appendChild(flash);
      track(
        flash.animate([{ opacity: 0 }, { opacity: 0.55 }, { opacity: 0 }],
          // B134: + the event-effect delay so the flash pops as the bolt lands,
          // both held until the staged card has presented.
          { duration: 240, delay: (intent.delay ?? 0) + TRACER_MS - 70, fill: 'backwards', easing: 'ease-out' }),
        () => flash.remove(),
      );
      return;
    }
    case 'eventStage': {
      // B134: the event card flies out of the hand toward the bases, pausing
      // grown at the stage point ("held above the board"), then drops into the
      // discard. A hidden-hand play flips face-up mid-flight. The card's REAL
      // discard render stays hidden until the clone lands.
      const { from, to, faceDown, stage, pile, faceUp } = intent;
      const liveEl = intent.to ? findCard(intent.uuid) : null;
      hide(liveEl);
      const p = rel(from);
      const outer = document.createElement('div');
      Object.assign(outer.style, {
        position: 'absolute', left: `${p.left}px`, top: `${p.top}px`,
        width: `${from.w}px`, height: `${from.h}px`, transformOrigin: 'center',
        pointerEvents: 'none', zIndex: '12',
      } as CSSStyleDeclaration);
      const inner = document.createElement('div');
      Object.assign(inner.style, {
        width: '100%', height: '100%', position: 'relative', transformOrigin: 'center',
        filter: 'drop-shadow(0 16px 26px rgba(0, 0, 0, 0.55))',
      } as CSSStyleDeclaration);
      // B141: a PLOT lifts a cardback from the resource pile (the pile rect has
      // no card html); everything else clones the departing card.
      inner.appendChild(pile ? cardbackNode() : fitNode(from.html));
      outer.appendChild(inner);
      overlay.appendChild(outer);

      // Center-to-center deltas (outer's transform-origin is its center).
      const fcx = from.x + from.w / 2, fcy = from.y + from.h / 2;
      const dxS = stage.x - fcx, dyS = stage.y - fcy;
      const tStage = `translate(${dxS}px, ${dyS}px) scale(${EVENT_STAGE_SCALE})`;
      let tEnd: string;
      let fadeOut = false;
      if (to) {
        const dxE = (to.x + to.w / 2) - fcx, dyE = (to.y + to.h / 2) - fcy;
        tEnd = `translate(${dxE}px, ${dyE}px) scale(${to.w / from.w}, ${to.h / from.h})`;
      } else {
        tEnd = `translate(${dxS}px, ${dyS}px) scale(0.5)`;
        fadeOut = true;
      }
      track(
        outer.animate(
          [
            { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 0, easing: 'cubic-bezier(0.3, 0, 0.2, 1)' },
            { transform: tStage, opacity: 1, offset: EVENT_ARRIVE, easing: 'linear' },
            { transform: tStage, opacity: 1, offset: EVENT_DEPART, easing: 'cubic-bezier(0.5, 0, 0.7, 1)' },
            { transform: tEnd, opacity: fadeOut ? 0 : 1, offset: 1 },
          ],
          { duration: EVENT_TOTAL_MS, fill: 'both' },
        ),
        () => { outer.remove(); show(liveEl); },
      );
      // Hidden-hand / plot play: flip face-up mid-flight — swap the cardback for
      // the discard render (or, for a plot whose discard doesn't render, the
      // card art) at the flip's narrowest point.
      if (faceDown && (to || faceUp)) {
        const swap = window.setTimeout(() => { inner.replaceChildren(to ? fitNode(to.html) : artNode(faceUp!)); }, (EVENT_FLIP_DELAY + EVENT_FLIP_MS / 2) / rate);
        track(
          inner.animate(
            [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0.04)' }, { transform: 'scaleX(1)' }],
            { duration: EVENT_FLIP_MS, delay: EVENT_FLIP_DELAY, fill: 'backwards', easing: 'ease-in-out' },
          ),
          () => window.clearTimeout(swap),
        );
      }
      return;
    }
    case 'upgradeStage': {
      // B134: fly out of the hand, present grown above the unit, then tuck
      // under it — the clone lands at the unit's lower edge and fades out,
      // handing off to the real upgrade strip rendered beneath the overlay.
      // A hidden-hand play flips face-down → card-art mid-flight.
      const { from, unit, faceDown, faceUp, stage, pile } = intent;
      // Reveal the (pre-hidden) upgrade strip as the clone starts tucking down.
      const upg = scheduleUpgradeReveal(upgHidden, intent.uuid, (UPGRADE_DEPART * UPGRADE_TOTAL_MS) / rate);
      const p = rel(from);
      const outer = document.createElement('div');
      Object.assign(outer.style, {
        position: 'absolute', left: `${p.left}px`, top: `${p.top}px`,
        width: `${from.w}px`, height: `${from.h}px`, transformOrigin: 'center',
        pointerEvents: 'none', zIndex: '12',
      } as CSSStyleDeclaration);
      const inner = document.createElement('div');
      Object.assign(inner.style, {
        width: '100%', height: '100%', position: 'relative', transformOrigin: 'center',
        filter: 'drop-shadow(0 14px 22px rgba(0, 0, 0, 0.55))',
      } as CSSStyleDeclaration);
      // B141: a PLOT upgrade lifts a cardback from the resource pile.
      inner.appendChild(pile ? cardbackNode() : fitNode(from.html));
      outer.appendChild(inner);
      overlay.appendChild(outer);

      const fcx = from.x + from.w / 2, fcy = from.y + from.h / 2;
      const dxS = stage.x - fcx, dyS = stage.y - fcy;
      const tStage = `translate(${dxS}px, ${dyS}px) scale(${UPGRADE_STAGE_SCALE})`;
      // Land at the unit, biased to its lower edge, scaled to the unit width —
      // reads as the upgrade sliding beneath the unit.
      const dxE = (unit.x + unit.w / 2) - fcx;
      const dyE = (unit.y + unit.h * 0.62) - fcy;
      const tEnd = `translate(${dxE}px, ${dyE}px) scale(${unit.w / from.w})`;
      track(
        outer.animate(
          [
            { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 0, easing: 'cubic-bezier(0.3, 0, 0.2, 1)' },
            { transform: tStage, opacity: 1, offset: UPGRADE_ARRIVE, easing: 'linear' },
            { transform: tStage, opacity: 1, offset: UPGRADE_DEPART, easing: 'cubic-bezier(0.5, 0, 0.7, 1)' },
            { transform: tEnd, opacity: 0, offset: 1 },
          ],
          { duration: UPGRADE_TOTAL_MS, fill: 'both' },
        ),
        () => { upg.reveal(); outer.remove(); },
      );
      if (faceDown && faceUp) {
        const faceNode = document.createElement('div');
        Object.assign(faceNode.style, {
          position: 'absolute', inset: '0', backgroundImage: `url(${faceUp})`,
          backgroundSize: 'contain', backgroundPosition: 'center', borderRadius: '7px',
        } as CSSStyleDeclaration);
        const swap = window.setTimeout(() => { inner.replaceChildren(faceNode); }, (EVENT_FLIP_DELAY + EVENT_FLIP_MS / 2) / rate);
        track(
          inner.animate(
            [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0.04)' }, { transform: 'scaleX(1)' }],
            { duration: EVENT_FLIP_MS, delay: EVENT_FLIP_DELAY, fill: 'backwards', easing: 'ease-in-out' },
          ),
          () => window.clearTimeout(swap),
        );
      }
      return;
    }
    case 'leaderDeploy': {
      // B134: raise the leader off the table (grow + lift), hold, flip to its
      // unit side, then bring it down to the board slot with a board shake on
      // landing. The real deployed unit stays hidden until the clone lands.
      const { from, to, stage } = intent;
      const liveEl = findCard(intent.uuid);
      hide(liveEl);
      // Vignette: darken the board edges as the leader rises (spotlighting it),
      // hold through the present AND the slam-down, then lift AFTER it lands.
      // Sits just under the leader clone (zIndex 14) and over the board.
      const vigTotal = LEADER_DEPLOY_TOTAL + VIGNETTE_LINGER_MS;
      const vigIn = LEADER_DEPLOY_RISE_MS / vigTotal;          // faded in by the time it's up
      const vigHoldEnd = LEADER_DEPLOY_TOTAL / vigTotal;       // still full when the leader lands
      const vignette = document.createElement('div');
      Object.assign(vignette.style, {
        position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '13', opacity: '0',
        // Strong spotlight: a tight clear center over the leader falling off fast
        // to near-black at the edges.
        background: 'radial-gradient(ellipse 62% 62% at 50% 45%, transparent 14%, rgba(0,0,0,0.92) 86%)',
      } as CSSStyleDeclaration);
      overlay.appendChild(vignette);
      track(
        vignette.animate(
          [{ opacity: 0, offset: 0 }, { opacity: 0.9, offset: vigIn }, { opacity: 0.9, offset: vigHoldEnd }, { opacity: 0, offset: 1 }],
          { duration: vigTotal, easing: 'ease-in-out' }),
        () => vignette.remove(),
      );
      const p = rel(from);
      const outer = document.createElement('div');
      Object.assign(outer.style, {
        position: 'absolute', left: `${p.left}px`, top: `${p.top}px`,
        width: `${from.w}px`, height: `${from.h}px`, transformOrigin: 'center',
        pointerEvents: 'none', zIndex: '14',
      } as CSSStyleDeclaration);
      const inner = document.createElement('div');
      Object.assign(inner.style, {
        width: '100%', height: '100%', position: 'relative', transformOrigin: 'center',
        filter: 'drop-shadow(0 22px 34px rgba(0, 0, 0, 0.6))',
      } as CSSStyleDeclaration);
      const leaderFace = fitNode(from.html); // leader side
      // Drop the player-name nameplate so only the CARD rises (it also stays
      // rendered on the board, which would otherwise read as a duplicate).
      leaderFace.querySelectorAll('[data-leader-nameplate]').forEach((el) => el.remove());
      inner.appendChild(leaderFace);
      outer.appendChild(inner);
      overlay.appendChild(outer);

      const fcx = from.x + from.w / 2, fcy = from.y + from.h / 2;
      const dxS = stage.x - fcx, dyS = stage.y - fcy;
      const tStage = `translate(${dxS}px, ${dyS}px) scale(${LEADER_DEPLOY_SCALE})`;
      const dxE = (to.x + to.w / 2) - fcx, dyE = (to.y + to.h / 2) - fcy;
      const tEnd = `translate(${dxE}px, ${dyE}px) scale(${to.w / from.w})`;
      const arrive = LEADER_DEPLOY_RISE_MS / LEADER_DEPLOY_TOTAL;
      const depart = (LEADER_DEPLOY_RISE_MS + LEADER_DEPLOY_HOLD_MS) / LEADER_DEPLOY_TOTAL;
      const outerAnim = outer.animate(
        [
          { transform: 'translate(0,0) scale(1)', offset: 0, easing: 'cubic-bezier(0.2, 0, 0.2, 1)' },
          { transform: tStage, offset: arrive, easing: 'linear' },
          { transform: tStage, offset: depart, easing: 'cubic-bezier(0.55, 0, 0.85, 0.5)' }, // accelerate the slam
          { transform: tEnd, offset: 1 },
        ],
        { duration: LEADER_DEPLOY_TOTAL, fill: 'both' },
      );
      track(outerAnim, () => { outer.remove(); show(liveEl); });
      // Shake the whole board ONLY on a real landing (not a rapid-step cancel).
      outerAnim.addEventListener('finish', () => shakeBoard(ctx.container, rate));
      // Flip leader → unit side as the slam begins.
      const flipDelay = LEADER_DEPLOY_RISE_MS + LEADER_DEPLOY_HOLD_MS;
      const swap = window.setTimeout(() => { inner.replaceChildren(fitNode(to.html)); }, (flipDelay + 130) / rate);
      track(inner.animate(
        [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0.04)' }, { transform: 'scaleX(1)' }],
        { duration: 280, delay: flipDelay, fill: 'backwards', easing: 'ease-in-out' }),
        () => window.clearTimeout(swap));
      return;
    }
    case 'pilotDeploy': {
      // B141: a PILOT leader deploy — rise off the base under a spotlight like a
      // normal deploy (flipping to the leader's UNIT side at the top, where the
      // upgrade text lives), then DESCEND + shrink onto the vehicle (tucking on
      // as an upgrade) and fade into the rendered strip — shaking the board on
      // landing, same as a regular leader deploy as a unit.
      const { from, unit, stage, faceUp } = intent;
      const vigTotal = LEADER_DEPLOY_TOTAL + VIGNETTE_LINGER_MS;
      const vigIn = LEADER_DEPLOY_RISE_MS / vigTotal;
      const vigHoldEnd = LEADER_DEPLOY_TOTAL / vigTotal;
      const vignette = document.createElement('div');
      Object.assign(vignette.style, {
        position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '13', opacity: '0',
        background: 'radial-gradient(ellipse 62% 62% at 50% 45%, transparent 16%, rgba(0,0,0,0.88) 88%)',
      } as CSSStyleDeclaration);
      overlay.appendChild(vignette);
      track(
        vignette.animate(
          [{ opacity: 0, offset: 0 }, { opacity: 0.85, offset: vigIn }, { opacity: 0.85, offset: vigHoldEnd }, { opacity: 0, offset: 1 }],
          { duration: vigTotal, easing: 'ease-in-out' }),
        () => vignette.remove(),
      );
      const p = rel(from);
      const outer = document.createElement('div');
      Object.assign(outer.style, {
        position: 'absolute', left: `${p.left}px`, top: `${p.top}px`,
        width: `${from.w}px`, height: `${from.h}px`, transformOrigin: 'center',
        pointerEvents: 'none', zIndex: '14',
      } as CSSStyleDeclaration);
      const inner = document.createElement('div');
      Object.assign(inner.style, {
        width: '100%', height: '100%', position: 'relative', transformOrigin: 'center',
        filter: 'drop-shadow(0 18px 30px rgba(0, 0, 0, 0.6))',
      } as CSSStyleDeclaration);
      const face = fitNode(from.html);
      face.querySelectorAll('[data-leader-nameplate]').forEach((el) => el.remove());
      inner.appendChild(face);
      outer.appendChild(inner);
      overlay.appendChild(outer);

      const fcx = from.x + from.w / 2, fcy = from.y + from.h / 2;
      const tStage = `translate(${stage.x - fcx}px, ${stage.y - fcy}px) scale(${LEADER_DEPLOY_SCALE})`;
      // Land at the lower band of the vehicle (where the upgrade strip sits), shrunk.
      const ucx = unit.x + unit.w / 2, ucy = unit.y + unit.h * 0.72;
      const tEnd = `translate(${ucx - fcx}px, ${ucy - fcy}px) scale(${(unit.w / from.w) * 0.6})`;
      const arrive = LEADER_DEPLOY_RISE_MS / LEADER_DEPLOY_TOTAL;
      const depart = (LEADER_DEPLOY_RISE_MS + LEADER_DEPLOY_HOLD_MS) / LEADER_DEPLOY_TOTAL;
      // Reveal the (pre-hidden) upgrade strip as the descent (depart → end) begins.
      const upg = scheduleUpgradeReveal(upgHidden, intent.uuid, (depart * LEADER_DEPLOY_TOTAL) / rate);
      const outerAnim = outer.animate(
        [
          { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 0, easing: 'cubic-bezier(0.2, 0, 0.2, 1)' },
          { transform: tStage, opacity: 1, offset: arrive, easing: 'linear' },
          { transform: tStage, opacity: 1, offset: depart, easing: 'cubic-bezier(0.5, 0, 0.7, 1)' },
          { transform: tEnd, opacity: 0, offset: 1 },
        ],
        { duration: LEADER_DEPLOY_TOTAL, fill: 'both' },
      );
      track(outerAnim, () => { upg.reveal(); outer.remove(); });
      outerAnim.addEventListener('finish', () => shakeBoard(ctx.container, rate));
      // Flip leader → unit side at the TOP of the rise (vs the slam, for a normal
      // deploy) — the unit side carries the upgrade text it's about to become.
      if (faceUp) {
        const flipDelay = LEADER_DEPLOY_RISE_MS;
        const swap = window.setTimeout(() => { inner.replaceChildren(artNode(faceUp)); }, (flipDelay + 130) / rate);
        track(inner.animate(
          [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0.04)' }, { transform: 'scaleX(1)' }],
          { duration: 280, delay: flipDelay, fill: 'backwards', easing: 'ease-in-out' }),
          () => window.clearTimeout(swap));
      }
      return;
    }
    case 'resourceStage': {
      // B134: a card committed to resources — grows (presented face-up), flips,
      // then shrinks into the resource pile and fades (the pile is one stacked
      // box, so there's no per-card destination render to hand off to).
      const { from, pile, stage, faceDown } = intent;
      // No per-card stagger — cards resourced together present side by side
      // simultaneously (the game-start two-card opening), pause, then drop in.
      const startDelay = 0;
      const p = rel(from);
      const outer = document.createElement('div');
      Object.assign(outer.style, {
        position: 'absolute', left: `${p.left}px`, top: `${p.top}px`,
        width: `${from.w}px`, height: `${from.h}px`, transformOrigin: 'center',
        pointerEvents: 'none', zIndex: '12', opacity: '0',
      } as CSSStyleDeclaration);
      const inner = document.createElement('div');
      Object.assign(inner.style, {
        width: '100%', height: '100%', position: 'relative', transformOrigin: 'center',
        filter: 'drop-shadow(0 14px 22px rgba(0, 0, 0, 0.55))',
      } as CSSStyleDeclaration);
      inner.appendChild(fitNode(from.html));
      outer.appendChild(inner);
      overlay.appendChild(outer);

      const fcx = from.x + from.w / 2, fcy = from.y + from.h / 2;
      const dxS = stage.x - fcx, dyS = stage.y - fcy;
      const tStage = `translate(${dxS}px, ${dyS}px) scale(${RESOURCE_STAGE_SCALE})`;
      const dxE = (pile.x + pile.w / 2) - fcx, dyE = (pile.y + pile.h / 2) - fcy;
      const tEnd = `translate(${dxE}px, ${dyE}px) scale(${Math.max(0.25, pile.w / from.w)})`;
      track(
        outer.animate(
          [
            { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 0, easing: 'cubic-bezier(0.3, 0, 0.2, 1)' },
            { transform: tStage, opacity: 1, offset: RESOURCE_ARRIVE, easing: 'linear' },
            { transform: tStage, opacity: 1, offset: RESOURCE_DEPART, easing: 'cubic-bezier(0.5, 0, 0.7, 1)' },
            { transform: tEnd, opacity: 0, offset: 1 },
          ],
          { duration: RESOURCE_TOTAL_MS, delay: startDelay, fill: 'both' },
        ),
        () => outer.remove(),
      );
      // A FACE-UP source (your own card, or a hands-up reveal) flips to the
      // cardback as it commits — that's how a card is resourced in the physical
      // game. The flip starts AFTER the read-hold (as the drop begins), so the
      // face sits readable through the pause. An already-face-down source (the
      // opponent's hidden hand) is a cardback throughout, so it just drops.
      if (!faceDown) {
        const flipDelay = startDelay + RESOURCE_RISE_MS + RESOURCE_HOLD_MS;
        const back = document.createElement('div');
        Object.assign(back.style, {
          position: 'absolute', inset: '0', backgroundImage: `url(${CARDBACK_URL})`,
          backgroundSize: 'contain', backgroundPosition: 'center', borderRadius: '7px',
        } as CSSStyleDeclaration);
        const swap = window.setTimeout(() => { inner.replaceChildren(back); }, (flipDelay + 150) / rate);
        track(inner.animate(
          [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0.04)' }, { transform: 'scaleX(1)' }],
          { duration: 300, delay: flipDelay, fill: 'backwards', easing: 'ease-in-out' }),
          () => window.clearTimeout(swap));
      }
      return;
    }
    case 'playFlip':
      playFlip(ctx, { uuid: intent.uuid, from: intent.from, to: intent.to });
      return;
  }
}

// B134: measure a single element (by selector) into a Snap of absolute screen
// coords — same frame as the card snapshots. Null when absent / zero-size.
function makeClone(html: string, pos: { left: number; top: number }, w: number, h: number): HTMLElement {
  const box = document.createElement('div');
  box.innerHTML = html;
  const node = (box.firstElementChild as HTMLElement) ?? box;
  node.style.position = 'absolute';
  node.style.left = `${pos.left}px`;
  node.style.top = `${pos.top}px`;
  node.style.width = `${w}px`;
  node.style.height = `${h}px`;
  node.style.margin = '0';
  node.style.pointerEvents = 'none';
  node.style.transformOrigin = '0 0';
  return node;
}

// A clone of a card sized to fill its parent (for the flip's front/back faces).
function fitNode(html: string): HTMLElement {
  const box = document.createElement('div');
  box.innerHTML = html;
  const node = (box.firstElementChild as HTMLElement) ?? box;
  Object.assign(node.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', margin: '0' } as CSSStyleDeclaration);
  return node;
}

// B141: a fill-parent card BACK (a plot card lifting face-down from the resource
// pile) and a fill-parent FACE from card art (the flip target). Square cardback
// renders `contain` so its logo isn't cropped.
function cardbackNode(): HTMLElement {
  const n = document.createElement('div');
  Object.assign(n.style, {
    position: 'absolute', inset: '0', borderRadius: '7px', backgroundColor: '#0a0c10',
    backgroundImage: `url(${CARDBACK_URL})`, backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
  } as CSSStyleDeclaration);
  return n;
}
function artNode(url: string): HTMLElement {
  const n = document.createElement('div');
  Object.assign(n.style, {
    position: 'absolute', inset: '0', borderRadius: '7px',
    backgroundImage: `url(${url})`, backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
  } as CSSStyleDeclaration);
  return n;
}

// Hide a freshly-played upgrade strip until its clone tucks down onto the unit.
// We inject a CSS rule matching the strip's data-upgrade-uuid rather than set an
// inline style on the node: the rule is in the stylesheet BEFORE the first paint
// (so the strip never flashes in on play-start) and it keeps matching even if
// React re-renders/recreates the strip node mid-animation (the attribute comes
// from props). reveal() — at descent-start, and again on animation cleanup —
// drops the rule so the strip renders normally under the landing clone.
// Schedule the reveal of a (pre-hidden) upgrade strip `delayMs` from now — when
// its clone begins tucking down. The strip was hidden before measure() in the
// effect; here we just time-out its removal. Falls back to hiding now if the
// strip wasn't pre-hidden (e.g. zones were unknown). reveal() drops it early
// (animation cleanup). Scheduling a timer also MARKS the entry as "claimed", so
// the effect's post-loop sweep leaves it hidden until the timer fires.
function scheduleUpgradeReveal(
  upgHidden: Map<string, { style: HTMLStyleElement; timer: number | null }>,
  uuid: string,
  delayMs: number,
): { reveal: () => void } {
  let entry = upgHidden.get(uuid);
  if (!entry) {
    const style = document.createElement('style');
    style.textContent = `[data-upgrade-uuid="${cssEscape(uuid)}"]{display:none!important}`;
    document.head.appendChild(style);
    entry = { style, timer: null };
    upgHidden.set(uuid, entry);
  }
  const e = entry;
  const remove = () => { e.style.remove(); upgHidden.delete(uuid); };
  if (e.timer != null) window.clearTimeout(e.timer);
  e.timer = window.setTimeout(remove, delayMs);
  return { reveal: () => { if (e.timer != null) window.clearTimeout(e.timer); remove(); } };
}

// B139: shake a card (a damaged base) with an amplitude proportional to the
// damage DEALT this frame — 1 is a tiny nudge, 7+ a big shake, 10+ huge. Returns
// the Animation so the caller can track() it (which scales it by playback speed
// and reverts the transform when the next frame cancels it).
function shakeCard(el: HTMLElement | null, damage: number): Animation | null {
  if (!el) return null;
  const a = Math.min(18, damage * 1.5 + 0.5); // 1→2px, 7→11px, 10→15.5px, ≥12→18px
  const dur = Math.min(460, 240 + damage * 20);
  return el.animate(
    [
      { transform: 'translate(0, 0)' },
      { transform: `translate(${-a}px, ${a * 0.5}px)` },
      { transform: `translate(${a * 0.85}px, ${-a * 0.4}px)` },
      { transform: `translate(${-a * 0.6}px, ${a * 0.3}px)` },
      { transform: `translate(${a * 0.4}px, ${-a * 0.2}px)` },
      { transform: `translate(${-a * 0.2}px, ${a * 0.1}px)` },
      { transform: 'translate(0, 0)' },
    ],
    { duration: dur, easing: 'cubic-bezier(0.36, 0.07, 0.19, 0.97)' },
  );
}

// B134: a brief impact shake of the whole board — the leader slamming down.
function shakeBoard(container: HTMLElement, rate = 1): void {
  const anim = container.animate(
    [
      { transform: 'translate(0, 0)' },
      { transform: 'translate(-5px, 4px)' },
      { transform: 'translate(5px, -3px)' },
      { transform: 'translate(-4px, 2px)' },
      { transform: 'translate(3px, -1px)' },
      { transform: 'translate(0, 0)' },
    ],
    { duration: 380, easing: 'ease-out' },
  );
  anim.playbackRate = rate;
}

// B134: temporarily lift overflow-clipping on a card's ancestors (up to, not
// including, the board container) so a lunge that travels out of its unit cell
// — e.g. a leader striking a base across the board — isn't cut off. Returns a
// restore fn. The clipping ancestor is UnitsBoard's overflow:hidden grid.
function unclipAncestors(el: HTMLElement, container: HTMLElement): () => void {
  const touched: Array<[HTMLElement, string]> = [];
  let p = el.parentElement;
  while (p && p !== container && p !== document.body) {
    if (getComputedStyle(p).overflow !== 'visible') {
      touched.push([p, p.style.overflow]);
      p.style.overflow = 'visible';
    }
    p = p.parentElement;
  }
  return () => { for (const [node, prev] of touched) node.style.overflow = prev; };
}

// CSS.escape isn't guaranteed everywhere; uuids are safe chars but guard anyway.
function cssEscape(s: string): string {
  return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
}
