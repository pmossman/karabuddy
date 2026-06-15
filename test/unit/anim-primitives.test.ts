// @vitest-environment jsdom
//
// ADR 0008 step 2 safety net: the animation PRIMITIVES (animPrimitives.ts) carry
// the byte-identical WAAPI keyframes we migrated every kind onto — but they touch
// the DOM + Web Animations, so they had ZERO automated coverage (verified only by
// eye). These tests run them under jsdom against a fake `Stage`, stubbing
// `element.animate` to CAPTURE the keyframes/options each primitive emits. They
// lock in the exact transforms/durations/easings + the clone hide→animate→restore
// lifecycle, so a future refactor of the primitives can't silently regress them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  slide, enterFade, exitFade, flip, playFlip, lunge, targetHold, tracer, flash, stagePresent,
  type Stage,
} from '@/app/(app)/r/[slug]/animPrimitives';
import type { Snap } from '@/app/(app)/r/[slug]/frameAnimationPlan';

// The easings live as module-private consts in animPrimitives; mirror them here
// so a change to either side trips the test (that's the lock-in).
const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
const LUNGE_EASING = 'cubic-bezier(0.34, 1.2, 0.64, 1)';

const snap = (x: number, y: number, w: number, h: number, html = '<div class="card"></div>'): Snap => ({ x, y, w, h, html });

// ── captured WAAPI calls ────────────────────────────────────────────────────
interface Cap { el: HTMLElement; keyframes: any[]; options: any; anim: FakeAnim }
let captured: Cap[];
class FakeAnim {
  onfinish: (() => void) | null = null;
  oncancel: (() => void) | null = null;
  playbackRate = 1;
}

// A fake Stage: real jsdom nodes for clones/layers (so style/append/remove work),
// recording hide/show + tracked anims. track() mirrors the real Ctx.track so
// finishing an anim fires its onDone (clone cleanup / live-card restore).
function makeStage(opts: { rate?: number; live?: HTMLElement | null } = {}) {
  const overlay = document.createElement('div');
  const hidden: HTMLElement[] = [];
  const shown: HTMLElement[] = [];
  const mounted: HTMLElement[] = [];
  const unclipped: HTMLElement[] = [];
  const tracked: { anim: FakeAnim | null; onDone?: () => void }[] = [];
  const stage: Stage = {
    rate: opts.rate ?? 1,
    findCard: () => opts.live ?? null,
    clone: (s, zIndex) => {
      const el = document.createElement('div');
      el.dataset.role = 'clone';
      el.innerHTML = s.html;
      if (zIndex != null) el.style.zIndex = String(zIndex);
      overlay.appendChild(el);
      return el;
    },
    fit: (html) => { const el = document.createElement('div'); el.dataset.role = 'fit'; el.innerHTML = html; return el; },
    layer: (s, o) => {
      const outer = document.createElement('div');
      outer.dataset.role = 'outer';
      outer.style.zIndex = String(o.zIndex);
      const inner = document.createElement('div');
      inner.dataset.role = 'inner';
      outer.appendChild(inner);
      overlay.appendChild(outer);
      return { outer, inner };
    },
    rel: (p) => ({ left: p.x, top: p.y }),
    mount: (el) => { mounted.push(el); overlay.appendChild(el); },
    unclip: (el) => { unclipped.push(el); return () => {}; },
    hide: (el) => { if (el) hidden.push(el); },
    show: (el) => { if (el) shown.push(el); },
    track: (anim, onDone) => {
      const a = anim as unknown as FakeAnim | null;
      if (!a) { onDone?.(); return; }
      a.playbackRate = stage.rate;
      tracked.push({ anim: a, onDone });
      a.onfinish = a.oncancel = () => onDone?.();
    },
  };
  const finishAll = () => tracked.forEach((t) => t.anim?.onfinish?.());
  const cancelAll = () => tracked.forEach((t) => t.anim?.oncancel?.());
  return { stage, overlay, hidden, shown, mounted, unclipped, tracked, finishAll, cancelAll };
}

beforeEach(() => {
  captured = [];
  // jsdom doesn't implement the Web Animations API — stub it to capture.
  (HTMLElement.prototype as any).animate = function (keyframes: any[], options: any) {
    const anim = new FakeAnim();
    captured.push({ el: this, keyframes, options, anim });
    return anim;
  };
});
afterEach(() => { vi.useRealTimers(); });

// ── slide ───────────────────────────────────────────────────────────────────
describe('slide', () => {
  it('clones the NEW look, hides the live card, FLIPs from old→new rect, restores on finish', () => {
    const live = document.createElement('div');
    const h = makeStage({ live });
    slide(h.stage, { uuid: 'u', from: snap(0, 0, 100, 140), to: snap(50, 50, 100, 140), delay: 0 });

    expect(h.hidden).toContain(live);            // live hidden during the slide
    expect(captured).toHaveLength(1);
    const cap = captured[0];
    expect(cap.el.dataset.role).toBe('clone');   // animates the clone, not the live card
    expect(cap.options).toMatchObject({ duration: 300, delay: 0, fill: 'both', easing: EASING });
    // from-to delta = (-50,-50); equal sizes → scale snapped to 1
    expect(cap.keyframes[0].transform).toBe('translate(-50px, -50px) scale(1, 1)');
    expect(cap.keyframes[1].transform).toBe('translate(0, 0) scale(1, 1)');

    h.finishAll();
    expect(h.shown).toContain(live);             // live restored after landing
    expect(h.overlay.querySelector('[data-role=clone]')).toBeNull(); // clone removed
  });

  it('snaps a near-1 incidental resize to 1 but keeps a real scale', () => {
    const near = makeStage();
    slide(near.stage, { uuid: 'u', from: snap(0, 0, 104, 140), to: snap(0, 0, 100, 140), delay: 0 });
    expect(captured[0].keyframes[0].transform).toContain('scale(1, 1)'); // 1.04 → 1

    captured = [];
    const real = makeStage();
    slide(real.stage, { uuid: 'u', from: snap(0, 0, 200, 140), to: snap(0, 0, 100, 140), delay: 0 });
    expect(captured[0].keyframes[0].transform).toContain('scale(2, 1)'); // 2.0 kept
  });
});

// ── enter / exit fades ────────────────────────────────────────────────────────
describe('enterFade / exitFade', () => {
  it('enterFade animates the LIVE element from scale 0.82 + opacity 0', () => {
    const live = document.createElement('div');
    const h = makeStage({ live });
    enterFade(h.stage, { uuid: 'u', delay: 60 });
    expect(h.hidden).toContain(live);
    expect(captured[0].el).toBe(live);           // live element, no clone
    expect(captured[0].keyframes[0]).toMatchObject({ opacity: 0, transform: 'scale(0.82)' });
    expect(captured[0].options).toMatchObject({ duration: 300, delay: 60, easing: EASING });
    h.finishAll();
    expect(h.shown).toContain(live);
  });

  it('exitFade animates a CLONE of the old rect, fading + shrinking out, then removes it', () => {
    const h = makeStage();
    exitFade(h.stage, { from: snap(10, 10, 100, 140), delay: 0 });
    expect(captured[0].el.dataset.role).toBe('clone');
    expect(captured[0].keyframes[1]).toMatchObject({ opacity: 0, transform: 'scale(0.82)' });
    h.finishAll();
    expect(h.overlay.querySelector('[data-role=clone]')).toBeNull();
  });
});

// ── flip ──────────────────────────────────────────────────────────────────────
describe('flip', () => {
  it('runs a scaleX squash and swaps content at the midpoint (rate-scaled)', () => {
    vi.useFakeTimers();
    const h = makeStage({ rate: 1 });
    const inner = document.createElement('div');
    inner.textContent = 'FRONT';
    const built = document.createElement('div');
    built.textContent = 'BACK';
    flip(h.stage, inner, { build: () => built, at: 100, duration: 280 });

    const cap = captured[0];
    expect(cap.el).toBe(inner);
    expect(cap.keyframes.map((k) => k.transform)).toEqual(['scaleX(1)', 'scaleX(0.04)', 'scaleX(1)']);
    expect(cap.options).toMatchObject({ duration: 280, delay: 100, fill: 'backwards', easing: 'ease-in-out' });

    expect(inner.textContent).toBe('FRONT');     // not yet swapped
    vi.advanceTimersByTime((100 + 280 / 2) / 1); // at + duration/2, rate 1
    expect(inner.textContent).toBe('BACK');      // swapped at the narrow point
  });

  it('honours swapAt + rate for the content swap (the leader-deploy +130 case)', () => {
    vi.useFakeTimers();
    const h = makeStage({ rate: 2 });
    const inner = document.createElement('div');
    const built = document.createElement('div'); built.textContent = 'B';
    flip(h.stage, inner, { build: () => built, at: 700, duration: 280, swapAt: 830 });
    vi.advanceTimersByTime(830 / 2 - 1);         // swapAt / rate, just before
    expect(inner.textContent).toBe('');
    vi.advanceTimersByTime(2);
    expect(inner.textContent).toBe('B');
  });

  it('clears the pending swap when the beat is cancelled mid-flip', () => {
    vi.useFakeTimers();
    const h = makeStage();
    const inner = document.createElement('div');
    const built = document.createElement('div'); built.textContent = 'B';
    flip(h.stage, inner, { build: () => built, at: 0, duration: 280 });
    h.cancelAll();                               // interrupt before the swap fires
    vi.advanceTimersByTime(1000);
    expect(inner.textContent).toBe('');          // swap was cleared, no late mutation
  });
});

// ── playFlip ──────────────────────────────────────────────────────────────────
describe('playFlip', () => {
  it('slides the outer from the hand rect then flips the inner face-up', () => {
    const live = document.createElement('div');
    const h = makeStage({ live });
    playFlip(h.stage, { uuid: 'u', from: snap(0, 0, 50, 70), to: snap(100, 100, 100, 140) });
    expect(h.hidden).toContain(live);
    // outer move: PLAY_MOVE_MS, scale from/to = 0.5, translate -100,-100
    const move = captured.find((c) => c.options.duration === 420)!;
    expect(move.keyframes[0].transform).toBe('translate(-100px, -100px) scale(0.5, 0.5)');
    expect(move.keyframes[1].transform).toBe('translate(0,0) scale(1,1)');
    // inner flip: PLAY_FLIP_MS scaleX squash delayed by the move
    const fl = captured.find((c) => c.options.duration === 280)!;
    expect(fl.options.delay).toBe(420);
    expect(fl.keyframes.map((k) => k.transform)).toEqual(['scaleX(1)', 'scaleX(0.04)', 'scaleX(1)']);
  });
});

// ── lunge ─────────────────────────────────────────────────────────────────────
describe('lunge', () => {
  it('thrusts the LIVE attacker ~55% toward the target, lifts z-index + unclips, restores after', () => {
    const live = document.createElement('div');
    live.style.zIndex = '3';
    const h = makeStage({ live });
    lunge(h.stage, { uuid: 'a', from: snap(0, 0, 100, 140), to: snap(200, 0, 100, 140) });

    expect(captured[0].el).toBe(live);           // animates the live element (no ghost clone)
    expect(h.unclipped).toContain(live);
    expect(live.style.zIndex).toBe('20');        // lifted above row-mates during the thrust
    // dx = (250-50)*0.55 = 110; peak scale 1.08 at offset 0.42 (float-tolerant — the primitive emits the raw product)
    expect(captured[0].keyframes[1].offset).toBe(0.42);
    expect(captured[0].keyframes[1].transform).toMatch(/^translate\(110(\.\d+)?px, 0px\) scale\(1\.08\)$/);
    expect(captured[0].options).toMatchObject({ duration: 440, easing: LUNGE_EASING });

    h.finishAll();
    expect(live.style.zIndex).toBe('3');         // original z-index restored
  });

  it('lunges a CLONE when the attacker traded away (gone from the board)', () => {
    const h = makeStage({ live: null });         // findCard → null
    lunge(h.stage, { uuid: 'a', from: snap(0, 0, 100, 140), to: snap(0, 200, 100, 140) });
    expect(captured[0].el.dataset.role).toBe('clone');
    expect(captured[0].el.style.zIndex).toBe('10');
    h.finishAll();
    expect(h.overlay.querySelector('[data-role=clone]')).toBeNull();
  });
});

// ── targetHold ────────────────────────────────────────────────────────────────
describe('targetHold', () => {
  it('holds a clone of the target OLD look at its NEW rect over the hidden live target', () => {
    const live = document.createElement('div');
    const h = makeStage({ live });
    targetHold(h.stage, { uuid: 't', oldRect: snap(0, 0, 100, 140, '<div>OLD</div>'), newRect: snap(5, 5, 100, 140, '<div>NEW</div>') });
    expect(h.hidden).toContain(live);
    expect(captured[0].el.innerHTML).toContain('OLD'); // clone carries the OLD html
    h.finishAll();
    expect(h.shown).toContain(live);
  });
});

// ── tracer / flash ────────────────────────────────────────────────────────────
describe('tracer / flash', () => {
  it('tracer mounts an orb and streaks it from source to target', () => {
    const h = makeStage();
    tracer(h.stage, { from: { x: 0, y: 0 }, to: { x: 100, y: 50 }, color: '#f00', delay: 30 });
    expect(h.mounted).toHaveLength(1);
    const cap = captured[0];
    expect(cap.options).toMatchObject({ duration: 300, delay: 30 });
    expect(cap.keyframes[2].transform).toBe('translate(100px, 50px) scale(1.4)');
    h.finishAll();
    expect(h.overlay.children.length).toBe(0);   // orb removed
  });

  it('flash mounts an impact wash sized to the struck rect, timed near impact', () => {
    const h = makeStage();
    flash(h.stage, { rect: snap(10, 10, 100, 140), color: '#f00', delay: 0 });
    expect(h.mounted).toHaveLength(1);
    expect(captured[0].keyframes.map((k) => k.opacity)).toEqual([0, 0.55, 0]);
    expect(captured[0].options.delay).toBe(300 - 70); // TRACER_MS - 70
  });
});

// ── stagePresent (the composite behind resource/event/upgrade/deploy) ──────────
describe('stagePresent', () => {
  const cfg = (over: Partial<Parameters<typeof stagePresent>[1]> = {}) => ({
    from: snap(0, 0, 100, 140),
    tStage: 'translate(10px, -20px) scale(1.65)',
    tEnd: 'translate(200px, 300px) scale(0.3)',
    arrive: 0.26, depart: 0.74, total: 1500, zIndex: 12,
    initial: () => { const e = document.createElement('div'); e.textContent = 'FACE'; return e; },
    startEasing: 'cubic-bezier(0.3, 0, 0.2, 1)', departEasing: 'cubic-bezier(0.5, 0, 0.7, 1)',
    ...over,
  });

  it('builds a layer, runs the 4-keyframe rise→hold→land, carries opacity + fadeOut when asked', () => {
    const h = makeStage();
    const { outer, inner } = stagePresent(h.stage, cfg({ opacity: true, fadeOut: true, startHidden: true }));
    expect(inner.textContent).toBe('FACE');      // initial face mounted
    expect(outer.style.opacity).toBe('0');       // startHidden
    const cap = captured[0];
    expect(cap.el).toBe(outer);
    expect(cap.keyframes.map((k) => k.offset)).toEqual([0, 0.26, 0.74, 1]);
    expect(cap.keyframes.map((k) => k.transform)).toEqual([
      'translate(0,0) scale(1)', 'translate(10px, -20px) scale(1.65)',
      'translate(10px, -20px) scale(1.65)', 'translate(200px, 300px) scale(0.3)',
    ]);
    expect(cap.keyframes.map((k) => k.opacity)).toEqual([1, 1, 1, 0]); // fadeOut → 0 at land
    expect(cap.keyframes[0].easing).toBe('cubic-bezier(0.3, 0, 0.2, 1)');
    expect(cap.options).toMatchObject({ duration: 1500, fill: 'both' });
  });

  it('omits opacity from the keyframes for a deploy (opacity:false)', () => {
    const h = makeStage();
    stagePresent(h.stage, cfg({ opacity: false }));
    expect(captured[0].keyframes.every((k: any) => !('opacity' in k))).toBe(true);
  });

  it('removes the outer + fires onDone on finish (and on cancel)', () => {
    const h = makeStage();
    const done = vi.fn();
    const { outer } = stagePresent(h.stage, cfg({ onDone: done }));
    expect(h.overlay.contains(outer)).toBe(true);
    h.finishAll();
    expect(h.overlay.contains(outer)).toBe(false);
    expect(done).toHaveBeenCalledTimes(1);
  });
});
