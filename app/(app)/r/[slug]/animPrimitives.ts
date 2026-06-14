// B147 / ADR 0008 (step 2): the animation PRIMITIVE vocabulary. Each kind of
// replay animation is composed from a few reusable, geometry-resolved
// primitives (slide, fade, flip, lunge, …) that run against a `Stage`. The
// FrameAnimator's per-frame ctx satisfies `Stage`; geometry arrives pre-resolved
// as `Snap`s, so primitives never touch the DOM. The legacy per-kind executors
// in FrameAnimator are being migrated onto these one kind at a time (each ported
// kind is byte-identical to its old executor, verified visually before the next).
import type { Snap } from './frameAnimationPlan';
import { DURATION, PLAY_MOVE_MS, PLAY_FLIP_MS, LUNGE_MS, TRACER_MS } from './animationTiming';

// Kept in sync with the legacy executors' easings during the migration;
// consolidated once every kind is ported.
const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
const LUNGE_EASING = 'cubic-bezier(0.34, 1.2, 0.64, 1)';

export interface Point { x: number; y: number }

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
  // Container-relative position of a screen point (for raw FX: orbs, flashes).
  rel(p: Point): { left: number; top: number };
  // Append a caller-built element (an FX node) to the overlay.
  mount(el: HTMLElement): void;
  // Temporarily lift overflow-clipping on a live card's ancestors (so a leader
  // lunging across the board to a base isn't cut off); returns a restore fn.
  unclip(el: HTMLElement): () => void;
  hide(el: HTMLElement | null): void;
  show(el: HTMLElement | null): void;
  track(anim: Animation | null, onDone?: () => void): void;
}

// FLIP: a card's inner faces flip (scaleX 1 → 0.04 → 1), swapping content at the
// narrow point. `at`/`duration` are unscaled; the swap timeout is rate-scaled so
// it lands at the flip's midpoint at any speed. `swapAt` overrides the swap time
// (unscaled ms) for the few executors whose hand-tuned swap isn't exactly the
// flip's midpoint (the leader/pilot deploys swap at +130 of a 280ms flip).
export function flip(
  stage: Stage,
  inner: HTMLElement,
  p: { build: () => HTMLElement; at: number; duration: number; easing?: string; swapAt?: number; onDone?: () => void },
): void {
  const swap = window.setTimeout(() => { inner.replaceChildren(p.build()); }, (p.swapAt ?? p.at + p.duration / 2) / stage.rate);
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

// STAGE-PRESENT: the shared "fly out → present grown at a stage point (held to
// read) → land" path behind every composite play (resource, event, upgrade,
// leader deploy). Builds the two-layer clone and runs the outer's 4-keyframe
// rise→hold→land; the caller flips the inner mid-flight (the `flip` primitive)
// and hooks the landing (board shake / upgrade reveal / show the live card) via
// the returned outer + Animation. Each migrated kind passes the EXACT transforms
// + offsets + easings its old executor used, so the port is byte-identical.
export function stagePresent(stage: Stage, p: {
  from: Snap;
  tStage: string;            // outer transform at the present point (center-delta + scale)
  tEnd: string;              // outer transform at the landing
  arrive: number;            // offset the card reaches the stage point
  depart: number;            // offset it leaves to land
  total: number;
  delay?: number;
  zIndex: number;
  shadow?: string;
  initial: () => HTMLElement;  // the first inner face (card front, or a cardback)
  opacity?: boolean;           // carry opacity in the keyframes (event/upgrade/resource)
  fadeOut?: boolean;           // fade to 0 on land (no destination render to hand to)
  startEasing: string;
  departEasing: string;
  startHidden?: boolean;       // outer starts opacity:0 inline (the resource stagger guard)
  onDone?: () => void;
}): { outer: HTMLElement; inner: HTMLElement; anim: Animation } {
  const { outer, inner } = stage.layer(p.from, { zIndex: p.zIndex, shadow: p.shadow });
  if (p.startHidden) outer.style.opacity = '0';
  inner.appendChild(p.initial());
  const op = (v: number) => (p.opacity ? { opacity: v } : {});
  const anim = outer.animate(
    [
      { transform: 'translate(0,0) scale(1)', ...op(1), offset: 0, easing: p.startEasing },
      { transform: p.tStage, ...op(1), offset: p.arrive, easing: 'linear' },
      { transform: p.tStage, ...op(1), offset: p.depart, easing: p.departEasing },
      { transform: p.tEnd, ...op(p.fadeOut ? 0 : 1), offset: 1 },
    ],
    { duration: p.total, delay: p.delay ?? 0, fill: 'both' },
  );
  stage.track(anim, () => { outer.remove(); p.onDone?.(); });
  return { outer, inner, anim };
}

// LUNGE: an attacker thrusts ~55% of the way to its target and recoils. A
// SURVIVING attacker lunges as the LIVE element (a clone could be left behind as
// a stationary ghost; animating the element itself can't diverge — WAAPI reverts
// on finish/cancel). A traded-away attacker (gone from the board) lunges a clone.
export function lunge(stage: Stage, p: { uuid: string; from: Snap; to: Snap }): void {
  const { from: a, to: t } = p;
  const dx = (t.x + t.w / 2 - (a.x + a.w / 2)) * 0.55;
  const dy = (t.y + t.h / 2 - (a.y + a.h / 2)) * 0.55;
  const kf = [
    { transform: 'translate(0,0) scale(1)', offset: 0 },
    { transform: `translate(${dx}px, ${dy}px) scale(1.08)`, offset: 0.42 },
    { transform: 'translate(0,0) scale(1)', offset: 1 },
  ];
  const live = stage.findCard(p.uuid);
  if (live) {
    const pz = live.style.zIndex, pp = live.style.position;
    if (!live.style.position) live.style.position = 'relative';
    live.style.zIndex = '20'; // above its row-mates during the traversal
    const unclipped = stage.unclip(live);
    stage.track(
      live.animate(kf, { duration: LUNGE_MS, easing: LUNGE_EASING }),
      () => { live.style.zIndex = pz; live.style.position = pp; unclipped(); },
    );
  } else {
    const el = stage.clone(a, 10);
    stage.track(el.animate(kf, { duration: LUNGE_MS, easing: LUNGE_EASING }), () => el.remove());
  }
}

// TARGET-HOLD: hold the target's OLD look (a clone, at its new rect) over the
// real card until the lunge connects, so its damage counter pops on impact.
export function targetHold(stage: Stage, p: { uuid: string; oldRect: Snap; newRect: Snap }): void {
  const t = stage.findCard(p.uuid);
  const clone = stage.clone({ ...p.newRect, html: p.oldRect.html });
  stage.hide(t);
  stage.track(clone.animate([{ opacity: 1 }, { opacity: 1 }], { duration: 230 }), () => { clone.remove(); stage.show(t); });
}

// TRACER: a colored bolt that streaks from a source point to a target (damage /
// heal). Invisible until it begins (matters when delayed behind a staged event).
export function tracer(stage: Stage, p: { from: Point; to: Point; color: string; delay?: number }): void {
  const size = 16;
  const o = stage.rel(p.from);
  const orb = document.createElement('div');
  Object.assign(orb.style, {
    position: 'absolute', left: `${o.left - size / 2}px`, top: `${o.top - size / 2}px`,
    width: `${size}px`, height: `${size}px`, borderRadius: '50%', opacity: '0',
    background: p.color, boxShadow: `0 0 10px 3px ${p.color}`, pointerEvents: 'none', zIndex: '11',
  } as CSSStyleDeclaration);
  stage.mount(orb);
  const dx = p.to.x - p.from.x, dy = p.to.y - p.from.y;
  stage.track(
    orb.animate(
      [{ transform: 'translate(0,0) scale(0.5)', opacity: 0.3, offset: 0 },
       { transform: `translate(${dx * 0.5}px, ${dy * 0.5}px) scale(1)`, opacity: 1, offset: 0.5 },
       { transform: `translate(${dx}px, ${dy}px) scale(1.4)`, opacity: 1, offset: 1 }],
      { duration: TRACER_MS, delay: p.delay ?? 0, easing: 'cubic-bezier(0.4, 0, 0.6, 1)' }),
    () => orb.remove(),
  );
}

// FLASH: a colored impact wash over the struck card, timed to land as the bolt
// connects (TRACER_MS - 70, + any event-effect delay).
export function flash(stage: Stage, p: { rect: Snap; color: string; delay?: number }): void {
  const f = stage.rel(p.rect);
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'absolute', left: `${f.left}px`, top: `${f.top}px`, width: `${p.rect.w}px`, height: `${p.rect.h}px`,
    borderRadius: '7px', background: p.color, opacity: '0', pointerEvents: 'none', zIndex: '9', mixBlendMode: 'screen',
  } as CSSStyleDeclaration);
  stage.mount(el);
  stage.track(
    el.animate([{ opacity: 0 }, { opacity: 0.55 }, { opacity: 0 }],
      { duration: 240, delay: (p.delay ?? 0) + TRACER_MS - 70, fill: 'backwards', easing: 'ease-out' }),
    () => el.remove(),
  );
}
