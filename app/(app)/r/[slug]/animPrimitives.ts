// B147 / ADR 0008 (step 2): the animation PRIMITIVE vocabulary. Each kind of
// replay animation is composed from a few reusable, geometry-resolved
// primitives (slide, fade, flip, lunge, …) that run against a `Stage`. The
// FrameAnimator's per-frame ctx satisfies `Stage`; geometry arrives pre-resolved
// as `Snap`s, so primitives never touch the DOM. The legacy per-kind executors
// in FrameAnimator are being migrated onto these one kind at a time (each ported
// kind is byte-identical to its old executor, verified visually before the next).
import type { Snap } from './frameAnimationPlan';
import { DURATION, PLAY_MOVE_MS, PLAY_FLIP_MS } from './animationTiming';

// Kept in sync with the legacy executors' EASING during the migration;
// consolidated once every kind is ported.
const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

// The render-side capabilities a primitive needs. Clones live in the overlay;
// `track` runs a cancellable, playback-rate-scaled animation and fires onDone on
// finish OR cancel (so an interrupted beat still cleans up). Geometry arrives
// pre-resolved as Snaps — primitives never query the board.
export interface Stage {
  rate: number;
  findCard(uuid: string): HTMLElement | null;
  // Single overlay clone of a measured card (its own outerHTML), at its position.
  clone(snap: Snap, zIndex?: number): HTMLElement;
  // A fill-parent node from card html (a flip face).
  fit(html: string): HTMLElement;
  // A two-layer overlay clone at `snap`: the OUTER drives translate/scale, the
  // INNER (center-origin) drives the flip + holds the face(s). The composite
  // choreographies (play/deploy/event/upgrade) all build on this.
  layer(snap: Snap, opts: { zIndex: number; origin?: string; shadow?: string }): { outer: HTMLElement; inner: HTMLElement };
  hide(el: HTMLElement | null): void;
  show(el: HTMLElement | null): void;
  track(anim: Animation | null, onDone?: () => void): void;
}

// FLIP: a card's inner faces flip (scaleX 1 → 0.04 → 1), swapping content at the
// narrow point. `at`/`duration` are unscaled; the swap timeout is rate-scaled so
// it lands at the flip's midpoint at any speed.
export function flip(
  stage: Stage,
  inner: HTMLElement,
  p: { build: () => HTMLElement; at: number; duration: number; easing?: string; onDone?: () => void },
): void {
  const swap = window.setTimeout(() => { inner.replaceChildren(p.build()); }, (p.at + p.duration / 2) / stage.rate);
  stage.track(
    inner.animate(
      [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0.04)' }, { transform: 'scaleX(1)' }],
      { duration: p.duration, delay: p.at, fill: 'backwards', easing: p.easing ?? 'ease-in-out' },
    ),
    () => { window.clearTimeout(swap); p.onDone?.(); },
  );
}

// SLIDE (FLIP): a card glides from its old rect to its new one. The clone carries
// the NEW look; the live card is hidden until it lands. A near-1 scale is snapped
// to 1 so an incidental grid resize doesn't also swell the card.
export function slide(stage: Stage, p: { uuid: string; from: Snap; to: Snap; delay: number }): void {
  const { from: o, to: n } = p;
  const live = stage.findCard(p.uuid);
  const el = stage.clone(n);
  const rawSx = o.w / n.w, rawSy = o.h / n.h;
  const sx = Math.abs(rawSx - 1) < 0.08 ? 1 : rawSx;
  const sy = Math.abs(rawSy - 1) < 0.08 ? 1 : rawSy;
  const startT = `translate(${o.x - n.x}px, ${o.y - n.y}px) scale(${sx}, ${sy})`;
  el.style.transform = startT;
  stage.hide(live);
  stage.track(
    el.animate(
      [{ transform: startT }, { transform: 'translate(0, 0) scale(1, 1)' }],
      { duration: DURATION, delay: p.delay, fill: 'both', easing: EASING },
    ),
    () => { el.remove(); stage.show(live); },
  );
}

// ENTER (fade): a card materializing in place (e.g. a created token). Animates
// the LIVE element — no clone — fading + scaling up from 0.82.
export function enterFade(stage: Stage, p: { uuid: string; delay: number }): void {
  const live = stage.findCard(p.uuid);
  if (!live) return;
  stage.hide(live);
  stage.track(
    live.animate(
      [{ opacity: 0, transform: 'scale(0.82)' }, { opacity: 1, transform: 'scale(1)' }],
      { duration: DURATION, delay: p.delay, fill: 'both', easing: EASING },
    ),
    () => stage.show(live),
  );
}

// EXIT (fade): a card leaving the board (defeated / bounced). Clones its OLD
// rect and fades + shrinks it out (the live card is already gone from the frame).
export function exitFade(stage: Stage, p: { from: Snap; delay: number }): void {
  const el = stage.clone(p.from);
  stage.track(
    el.animate(
      [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.82)' }],
      { duration: DURATION, delay: p.delay, fill: 'backwards', easing: EASING },
    ),
    () => el.remove(),
  );
}

// PLAY-FLIP: a card played from a hidden hand — it slides face-down from the
// opponent's hand into its arena slot, then flips to reveal the real card. slide
// (outer) + flip (inner), the first composite built from the shared layer/flip.
export function playFlip(stage: Stage, p: { uuid: string; from: Snap; to: Snap }): void {
  const { from, to } = p;
  const live = stage.findCard(p.uuid);
  stage.hide(live);
  const { outer, inner } = stage.layer(to, { zIndex: 8, origin: '0 0' });
  inner.appendChild(stage.fit(from.html)); // face-down to start
  const sx = from.w / to.w, sy = from.h / to.h, tx = from.x - to.x, ty = from.y - to.y;
  stage.track(outer.animate(
    [{ transform: `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})` }, { transform: 'translate(0,0) scale(1,1)' }],
    { duration: PLAY_MOVE_MS, fill: 'backwards', easing: EASING }));
  flip(stage, inner, {
    build: () => stage.fit(to.html),
    at: PLAY_MOVE_MS,
    duration: PLAY_FLIP_MS,
    onDone: () => { outer.remove(); stage.show(live); },
  });
}
