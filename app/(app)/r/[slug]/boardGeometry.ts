// B147 / ADR 0008 (step 2): the renderer's ONE seam to the live board DOM.
// Everything that animation needs to know about WHERE things are — card
// positions by identity (data-card-uuid) and the resource piles — comes through
// here, instead of the FrameAnimator querying the DOM inline. Backed by the
// React-rendered board today; the abstraction lets the planner/renderer resolve
// geometry without touching `querySelector`, and lets geometry be mocked in
// tests. Behavior-preserving extraction of the old inline `measure()` /
// `measureEl()`.
import type { Snap, Snapshot } from './frameAnimationPlan';

export interface BoardGeometry {
  // Every on-board card's rect (+ cloneable html), keyed by uuid.
  measureAll(): Snapshot;
  // One card's rect, or null if it isn't currently rendered.
  rectOf(uuid: string): Snap | null;
  // A resource pile's rect (no html — the pile has no per-card identity).
  resourcePile(side: 'mine' | 'opp'): Snap | null;
}

const RESOURCE_PILE_TESTID = { mine: 'my-resource-pile', opp: 'opp-resource-pile' } as const;

function rectFrom(el: HTMLElement, html: string): Snap | null {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  return { x: r.left, y: r.top, w: r.width, h: r.height, html };
}

function cssEscape(s: string): string {
  return (typeof window !== 'undefined' && window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
}

export function createBoardGeometry(container: HTMLElement): BoardGeometry {
  return {
    measureAll(): Snapshot {
      const map = new Map<string, Snap>();
      // Clones carry the same data-card-uuid; the caller clears the overlay
      // before measuring so only real board cards are seen. First (top-level) wins.
      container.querySelectorAll<HTMLElement>('[data-card-uuid]').forEach((el) => {
        const uuid = el.getAttribute('data-card-uuid');
        if (!uuid || map.has(uuid)) return;
        const snap = rectFrom(el, el.outerHTML);
        if (snap) map.set(uuid, snap);
      });
      return map;
    },
    rectOf(uuid: string): Snap | null {
      const el = container.querySelector<HTMLElement>(`[data-card-uuid="${cssEscape(uuid)}"]`);
      return el ? rectFrom(el, el.outerHTML) : null;
    },
    resourcePile(side): Snap | null {
      const el = container.querySelector<HTMLElement>(`[data-testid="${RESOURCE_PILE_TESTID[side]}"]`);
      return el ? rectFrom(el, '') : null;
    },
  };
}
