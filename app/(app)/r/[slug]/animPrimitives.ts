// B147 / ADR 0008 (step 2): the animation PRIMITIVE vocabulary. Each kind of
// replay animation is composed from a few reusable, geometry-resolved
// primitives (slide, fade, flip, lunge, …) that run against a `Stage`. The
// FrameAnimator's per-frame ctx satisfies `Stage`; geometry arrives pre-resolved
// as `Snap`s, so primitives never touch the DOM. The legacy per-kind executors
// in FrameAnimator are being migrated onto these one kind at a time (each ported
// kind is byte-identical to its old executor, verified visually before the next).
import type { Snap } from './frameAnimationPlan';
import { DURATION } from './animationTiming';

// Kept in sync with the legacy executors' EASING during the migration;
// consolidated once every kind is ported.
const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

// The render-side capabilities a primitive needs. Clones live in the overlay;
// `track` runs a cancellable, playback-rate-scaled animation and fires onDone on
// finish OR cancel (so an interrupted beat still cleans up).
export interface Stage {
  rate: number;
  findCard(uuid: string): HTMLElement | null;
  clone(snap: Snap, zIndex?: number): HTMLElement;
  hide(el: HTMLElement | null): void;
  show(el: HTMLElement | null): void;
  track(anim: Animation | null, onDone?: () => void): void;
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
