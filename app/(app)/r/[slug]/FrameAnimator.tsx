'use client';

import { useLayoutEffect, useRef } from 'react';
import { useGame } from '@/app/_contexts/Game.context';
import { extractFrameCards, extractAttacks, extractInteractions } from './frameLog';
import { planFrameAnimations, type Snap, type Snapshot, type Intent } from './frameAnimationPlan';

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

// Below this gap between frame changes we treat it as rapid stepping (held
// arrow) and snap without animating, so flying through a replay stays smooth.
const RAPID_STEP_MS = 110;
const DURATION = 300;
const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
const LUNGE_MS = 440;
const LUNGE_EASING = 'cubic-bezier(0.34, 1.2, 0.64, 1)';
const TRACER_MS = 300;
const PLAY_MOVE_MS = 420;
const PLAY_FLIP_MS = 280;

export function FrameAnimator({
  containerRef,
  enabled,
  direction,
  skipNextRef,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  enabled: boolean;
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
  const lastRun = useRef(0); // timestamp of the last frame change (rapid-step detection)
  const zones = useRef<Map<string, string>>(new Map()); // uuid → zone, previous frame
  const remeasureRaf = useRef<number | null>(null); // deferred settle-measure after a backward snap

  useLayoutEffect(() => {
    const container = containerRef.current;
    const overlay = overlayRef.current;
    if (!container || !overlay) return;

    const measure = (): Snapshot => {
      const map = new Map<string, Snap>();
      container.querySelectorAll<HTMLElement>('[data-card-uuid]').forEach((el) => {
        const uuid = el.getAttribute('data-card-uuid');
        if (!uuid || map.has(uuid)) return; // first (top-level) wins
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        map.set(uuid, { x: r.left, y: r.top, w: r.width, h: r.height, html: el.outerHTML });
      });
      return map;
    };

    // Cancel anything still running, un-hide cards from the last step, and remove
    // leftover clones — BEFORE measuring, so measure() only ever sees real board
    // cards (clones carry the same data-card-uuid and would be picked up). Also
    // drop any pending settle-measure from a prior backward step (this run will
    // set prev.current itself).
    active.current.forEach((a) => a.cancel());
    active.current = [];
    hidden.current.forEach((el) => { el.style.opacity = ''; });
    hidden.current = [];
    overlay.replaceChildren();
    if (remeasureRaf.current != null) { cancelAnimationFrame(remeasureRaf.current); remeasureRaf.current = null; }

    const now = performance.now();
    const dt = now - lastRun.current;
    lastRun.current = now;
    // B128: a POV swap render — snap, exactly like the rapid-step path (the
    // next real step re-measures from the settled mirrored layout).
    if (skipNextRef?.current) { skipNextRef.current = false; prev.current = null; return; }
    if (!enabled || dt < RAPID_STEP_MS) { prev.current = null; return; }

    const next = measure();
    const old = prev.current;
    prev.current = next;

    // Per-card zone this frame (kept in sync with `prev`). Comparing to the
    // previous frame's zones lets the planner tell a real cross-zone move from a
    // same-zone reflow, and a leader deploy/return from an arena reflow.
    const { cards, leaders } = extractFrameCards(gameState);
    const prevZones = zones.current;
    const nextZones = new Map<string, string>();
    for (const [u, c] of cards) nextZones.set(u, c.zone);
    zones.current = nextZones;

    // Backward step = rewind. Don't animate, and DON'T trust this measurement:
    // when a card re-enters going back, the board reflows the row AFTER we read
    // it here, so the destinations we'd slide clones to are stale (→ a ghost
    // clone parked at a wrong slot, which also poisons prev.current for the next
    // forward step). Snap instead, then re-measure the SETTLED layout on the next
    // frame so the following forward step animates from correct positions.
    if (dirRef.current < 0) {
      remeasureRaf.current = requestAnimationFrame(() => { remeasureRaf.current = null; prev.current = measure(); });
      return;
    }

    if (!old) return;

    const intents = planFrameAnimations({
      prev: old,
      next,
      prevZones,
      cards,
      leaders,
      attacks: extractAttacks(gameState),
      interactions: extractInteractions(gameState),
    });

    // ----- Execute -----
    const cRect = container.getBoundingClientRect();
    const ctx: Ctx = {
      overlay,
      cRect,
      rel: (s) => ({ left: s.x - cRect.left, top: s.y - cRect.top }),
      findCard: (uuid) => container.querySelector<HTMLElement>(`[data-card-uuid="${cssEscape(uuid)}"]`),
      track: (anim, onDone) => {
        if (!anim) { onDone?.(); return; }
        active.current.push(anim);
        anim.onfinish = anim.oncancel = () => { onDone?.(); };
      },
      hide: (el) => { if (el) { el.style.opacity = '0'; hidden.current.push(el); } },
      show: (el) => { if (el) el.style.opacity = ''; },
    };
    for (const intent of intents) runIntent(intent, ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState, enabled]);

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
  cRect: DOMRect;
  rel: (s: { x: number; y: number }) => { left: number; top: number };
  findCard: (uuid: string) => HTMLElement | null;
  track: (anim: Animation | null, onDone?: () => void) => void;
  hide: (el: HTMLElement | null) => void;
  show: (el: HTMLElement | null) => void;
}

// Turn one planned Intent into clones + Web-Animations calls. The "what" lives
// in the planner; this is only the "how" (geometry → keyframes). Each clone sets
// its start transform/opacity INLINE before the first paint so a delayed
// animation never flashes at its natural rect (fill:'backwards' alone can let
// one frame through); fill:'both' holds the end until the clone is removed.
function runIntent(intent: Intent, ctx: Ctx): void {
  const { overlay, rel, findCard, track, hide, show } = ctx;
  switch (intent.type) {
    case 'move': {
      const { uuid, from: o, to: n, delay } = intent;
      const liveEl = findCard(uuid);
      const clone = makeClone(n.html, rel(n), n.w, n.h);
      // Snap a near-1 scale to 1 so a slide with an incidental grid-resize
      // doesn't also swell — only real zone changes (big size diff) keep it.
      const rawSx = o.w / n.w, rawSy = o.h / n.h;
      const sx = Math.abs(rawSx - 1) < 0.08 ? 1 : rawSx;
      const sy = Math.abs(rawSy - 1) < 0.08 ? 1 : rawSy;
      const startT = `translate(${o.x - n.x}px, ${o.y - n.y}px) scale(${sx}, ${sy})`;
      clone.style.transform = startT;
      overlay.appendChild(clone);
      hide(liveEl);
      track(
        clone.animate([{ transform: startT }, { transform: 'translate(0, 0) scale(1, 1)' }],
          { duration: DURATION, delay, fill: 'both', easing: EASING }),
        () => { clone.remove(); show(liveEl); },
      );
      return;
    }
    case 'enter': {
      const liveEl = findCard(intent.uuid);
      if (!liveEl) return;
      hide(liveEl);
      track(
        liveEl.animate([{ opacity: 0, transform: 'scale(0.82)' }, { opacity: 1, transform: 'scale(1)' }],
          { duration: DURATION, delay: intent.delay, fill: 'both', easing: EASING }),
        () => show(liveEl),
      );
      return;
    }
    case 'exit': {
      const { rect: o, delay } = intent;
      const clone = makeClone(o.html, rel(o), o.w, o.h);
      overlay.appendChild(clone);
      track(
        clone.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.82)' }],
          { duration: DURATION, delay, fill: 'backwards', easing: EASING }),
        () => clone.remove(),
      );
      return;
    }
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
      const liveEl = findCard(uuid);
      const clone = makeClone(a.html, rel(a), a.w, a.h);
      clone.style.zIndex = '10';
      overlay.appendChild(clone);
      hide(liveEl);
      track(
        clone.animate(
          [{ transform: 'translate(0,0) scale(1)', offset: 0 },
           { transform: `translate(${dx}px, ${dy}px) scale(1.08)`, offset: 0.42 },
           { transform: 'translate(0,0) scale(1)', offset: 1 }],
          { duration: LUNGE_MS, easing: LUNGE_EASING }),
        () => { clone.remove(); show(liveEl); },
      );
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
        background: color, boxShadow: `0 0 10px 3px ${color}`, pointerEvents: 'none', zIndex: '11',
      } as CSSStyleDeclaration);
      overlay.appendChild(orb);
      const dx = to.x - from.x, dy = to.y - from.y;
      track(
        orb.animate(
          [{ transform: 'translate(0,0) scale(0.5)', opacity: 0.3, offset: 0 },
           { transform: `translate(${dx * 0.5}px, ${dy * 0.5}px) scale(1)`, opacity: 1, offset: 0.5 },
           { transform: `translate(${dx}px, ${dy}px) scale(1.4)`, opacity: 1, offset: 1 }],
          { duration: TRACER_MS, easing: 'cubic-bezier(0.4, 0, 0.6, 1)' }),
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
          { duration: 240, delay: TRACER_MS - 70, fill: 'backwards', easing: 'ease-out' }),
        () => flash.remove(),
      );
      return;
    }
    case 'playFlip': {
      // Slide the face-down card to its slot, then flip to reveal the played card.
      const { uuid, from, to } = intent;
      const liveEl = findCard(uuid);
      hide(liveEl);
      const p = rel(to);
      const outer = document.createElement('div');
      Object.assign(outer.style, {
        position: 'absolute', left: `${p.left}px`, top: `${p.top}px`,
        width: `${to.w}px`, height: `${to.h}px`, transformOrigin: '0 0', pointerEvents: 'none', zIndex: '8',
      } as CSSStyleDeclaration);
      const inner = document.createElement('div');
      Object.assign(inner.style, { width: '100%', height: '100%', transformOrigin: 'center', position: 'relative' } as CSSStyleDeclaration);
      inner.appendChild(fitNode(from.html)); // face-down card to start
      outer.appendChild(inner);
      overlay.appendChild(outer);
      const sx = from.w / to.w, sy = from.h / to.h, tx = from.x - to.x, ty = from.y - to.y;
      track(outer.animate(
        [{ transform: `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})` }, { transform: 'translate(0,0) scale(1,1)' }],
        { duration: PLAY_MOVE_MS, fill: 'backwards', easing: EASING }));
      const swap = window.setTimeout(() => { inner.replaceChildren(fitNode(to.html)); }, PLAY_MOVE_MS + PLAY_FLIP_MS / 2);
      track(
        inner.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0.04)' }, { transform: 'scaleX(1)' }],
          { duration: PLAY_FLIP_MS, delay: PLAY_MOVE_MS, fill: 'backwards', easing: 'ease-in-out' }),
        () => { window.clearTimeout(swap); outer.remove(); show(liveEl); },
      );
      return;
    }
  }
}

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

// CSS.escape isn't guaranteed everywhere; uuids are safe chars but guard anyway.
function cssEscape(s: string): string {
  return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
}
