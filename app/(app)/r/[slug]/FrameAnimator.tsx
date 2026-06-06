'use client';

import { useLayoutEffect, useRef } from 'react';
import { useGame } from '@/app/_contexts/Game.context';

// B104 (prototype): animate card movement between replay frames. Cards carry a
// stable `uuid` across frames + zones, and GameCard tags its DOM node with
// `data-card-uuid`. On each frame change we measure every card's screen rect by
// uuid, diff against the previous frame, and FLIP-animate the difference:
//   - moved (uuid in both, rect changed)  → a clone flies old→new (hand→board,
//     board→discard, …) while the real card is hidden until it lands.
//   - entered (uuid only in new, e.g. a draw) → the real card fades+scales in.
//   - exited (uuid only in old, e.g. to deck / opponent hand) → a snapshot of
//     the old card fades+shrinks where it was.
//
// Overlay-based (clones in an absolute layer over the board) so we don't have
// to thread FLIP refs through every lifted zone component. Driven off the game
// context's `gameState` so the effect runs AFTER the board re-renders the new
// frame. Imperative (WAAPI) — no React state per clone.

const DURATION = 300;
const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
// Below this gap between frame changes we treat it as rapid stepping (held
// arrow) and snap without animating. Above it, a deliberate step animates.
const RAPID_STEP_MS = 110;
// px of POSITION change to count as a real move. Deliberately ignores
// size-only changes: a CSS-grid arena resizes its cards by a few px when a unit
// enters/leaves, which is NOT a move — animating it reads as a weird "swell".
const MOVE_THRESHOLD = 8;

interface Snap {
  x: number; y: number; w: number; h: number;
  html: string; // outerHTML snapshot, for animating cards that unmount (exits)
}

export function FrameAnimator({
  containerRef,
  enabled,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  enabled: boolean;
}) {
  const { gameState } = useGame();
  const overlayRef = useRef<HTMLDivElement>(null);
  const prev = useRef<Map<string, Snap> | null>(null);
  // In-flight animations + cards we've hidden, so a fast step can cancel/restore.
  const active = useRef<Animation[]>([]);
  const hidden = useRef<HTMLElement[]>([]);
  const lastRun = useRef(0); // timestamp of the last frame change (rapid-step detection)
  const zones = useRef<Map<string, string>>(new Map()); // uuid → zone, previous frame

  useLayoutEffect(() => {
    const container = containerRef.current;
    const overlay = overlayRef.current;
    if (!container || !overlay) return;

    const measure = (): Map<string, Snap> => {
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

    // Cancel anything still running, un-hide cards from the last step, and
    // remove leftover clones — BEFORE measuring, so measure() + the per-uuid
    // queries below only ever see real board cards (clones carry the same
    // data-card-uuid and would otherwise be picked up).
    active.current.forEach((a) => a.cancel());
    active.current = [];
    hidden.current.forEach((el) => { el.style.opacity = ''; });
    hidden.current = [];
    overlay.replaceChildren();

    // Rapid stepping (held arrow / fast scrub) comes in faster than an
    // animation can play. Snap instead — and skip the expensive measure() — so
    // flying through a replay stays smooth. (`measure()` reflows every card.)
    const now = performance.now();
    const dt = now - lastRun.current;
    lastRun.current = now;
    if (!enabled || dt < RAPID_STEP_MS) { prev.current = null; return; }

    const next = measure();
    const old = prev.current;
    prev.current = next;

    // Zone per card this frame vs last — kept in sync with `prev` (built even
    // when we bail below) so it never goes stale after rapid stepping. Lets the
    // move loop tell a real cross-zone move (hand→resources/board, board→discard)
    // from a SAME-ZONE reflow (hand re-centering when a sibling is resourced, or
    // a card lifting as it's selected), which shouldn't animate — else the hand
    // "bumps" on every resource/draw step.
    const oldZones = zones.current;
    const nextZones = new Map<string, string>();
    for (const pid of Object.keys(gameState?.players || {})) {
      const piles = gameState.players[pid]?.cardPiles || {};
      for (const z of Object.keys(piles)) {
        for (const c of piles[z] || []) if (c?.uuid) nextZones.set(c.uuid, c.zone || z);
      }
    }
    zones.current = nextZones;

    if (!old) return;

    const cRect = container.getBoundingClientRect();
    const rel = (s: { x: number; y: number }) => ({ left: s.x - cRect.left, top: s.y - cRect.top });

    // Attacks: parse this frame's log ("X attacks Y[/base] with Z") for the
    // attacker + target uuids, so we can lunge the attacker at its target.
    // The attacker stays in its zone (so the move-FLIP below skips it).
    const attacks = parseAttacks(gameState).map((a) => ({
      attackerUuid: a.attackerUuid,
      targetUuid: a.targetUuid ?? resolveBaseTarget(gameState, a.attackerUuid),
    })).filter((a) => a.targetUuid);
    const attackers = new Set(attacks.map((a) => a.attackerUuid));

    // B104: when a frame contains an attack, choreograph it as a sequence —
    // attacker lunges first, then the defeated card dies, THEN the survivors
    // reflow — instead of all three firing at once (which reads as chaos).
    // `fill: 'backwards'` holds each card at its start position during its delay.
    const hasAttack = attacks.length > 0;
    const EXIT_DELAY = hasAttack ? 300 : 0;
    const MOVE_DELAY = hasAttack ? 540 : 0;

    // PLAYS: a card played from a hidden hand (opponent) shows up as a
    // face-down card EXITING + the real card ENTERING an arena (same
    // controllerId). Pair them so we can slide the face-down card over and
    // flip it, instead of a fade-out + fade-in. (Local plays are already a
    // normal move — same uuid — so they don't hit this path.)
    const cardInfo = new Map<string, { zone: string; ctrl: string }>();
    for (const pid of Object.keys(gameState?.players || {})) {
      const piles = gameState.players[pid]?.cardPiles || {};
      for (const z of Object.keys(piles)) {
        for (const c of piles[z] || []) if (c?.uuid) cardInfo.set(c.uuid, { zone: c.zone || z, ctrl: c.controllerId });
      }
    }
    const PLAY_ZONES = new Set(['groundArena', 'spaceArena']);
    const hiddenByCtrl = new Map<string, string[]>();
    for (const u of old.keys()) {
      if (next.has(u)) continue;
      const m = /^replay-hidden-(.+)-\d+$/.exec(u);
      if (m) { const arr = hiddenByCtrl.get(m[1]) ?? []; arr.push(u); hiddenByCtrl.set(m[1], arr); }
    }
    const plays: { played: string; hidden: string }[] = [];
    const pairedEnter = new Set<string>();
    const pairedExit = new Set<string>();
    for (const u of next.keys()) {
      if (old.has(u)) continue;
      const info = cardInfo.get(u);
      if (!info || !PLAY_ZONES.has(info.zone)) continue;
      const pool = hiddenByCtrl.get(info.ctrl);
      if (pool && pool.length) {
        const hidden = pool.shift()!;
        plays.push({ played: u, hidden });
        pairedEnter.add(u);
        pairedExit.add(hidden);
      }
    }

    const track = (anim: Animation | null, onDone?: () => void) => {
      if (!anim) { onDone?.(); return; }
      active.current.push(anim);
      anim.onfinish = anim.oncancel = () => { onDone?.(); };
    };

    for (const [uuid, n] of next) {
      if (attackers.has(uuid)) continue; // the lunge owns this card this frame
      const o = old.get(uuid);
      if (o) {
        // Same-zone reflow (hand re-centering, a card lifting as it's selected)
        // → snap, don't animate, so the hand doesn't bump on resource/draw steps.
        const oz = oldZones.get(uuid), nz = nextZones.get(uuid);
        if (oz && nz && oz === nz) continue;
        // MOVED — fly a clone of the (now-landed) card from old → new.
        const moved = Math.hypot(n.x - o.x, n.y - o.y) > MOVE_THRESHOLD;
        if (!moved) continue;
        const liveEl = container.querySelector<HTMLElement>(`[data-card-uuid="${cssEscape(uuid)}"]`);
        const clone = makeClone(n.html, rel(n), n.w, n.h);
        overlay.appendChild(clone);
        if (liveEl) { liveEl.style.opacity = '0'; hidden.current.push(liveEl); }
        // Invert: start mapped onto the old rect, play to identity. Snap a
        // near-1 scale to 1 so a slide with an incidental grid-resize doesn't
        // also swell — only real zone changes (big size diff) keep the scale.
        const rawSx = o.w / n.w, rawSy = o.h / n.h;
        const sx = Math.abs(rawSx - 1) < 0.08 ? 1 : rawSx;
        const sy = Math.abs(rawSy - 1) < 0.08 ? 1 : rawSy;
        const tx = o.x - n.x, ty = o.y - n.y;
        const anim = clone.animate(
          [
            { transform: `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})` },
            { transform: 'translate(0, 0) scale(1, 1)' },
          ],
          { duration: DURATION, delay: MOVE_DELAY, fill: 'backwards', easing: EASING },
        );
        track(anim, () => {
          clone.remove();
          if (liveEl) liveEl.style.opacity = '';
        });
      } else {
        if (pairedEnter.has(uuid)) continue; // animated as a play-flip below
        // ENTERED — fade + scale the real card in.
        const liveEl = container.querySelector<HTMLElement>(`[data-card-uuid="${cssEscape(uuid)}"]`);
        if (!liveEl) continue;
        const anim = liveEl.animate(
          [
            { opacity: 0, transform: 'scale(0.82)' },
            { opacity: 1, transform: 'scale(1)' },
          ],
          { duration: DURATION, delay: MOVE_DELAY, fill: 'backwards', easing: EASING },
        );
        track(anim);
      }
    }

    // EXITED — uuid gone from the new frame; fade a snapshot out where it was.
    for (const [uuid, o] of old) {
      if (next.has(uuid)) continue;
      if (pairedExit.has(uuid)) continue; // it's the face-down source of a play-flip
      const clone = makeClone(o.html, rel(o), o.w, o.h);
      overlay.appendChild(clone);
      const anim = clone.animate(
        [
          { opacity: 1, transform: 'scale(1)' },
          { opacity: 0, transform: 'scale(0.82)' },
        ],
        { duration: DURATION, delay: EXIT_DELAY, fill: 'backwards', easing: EASING },
      );
      track(anim, () => clone.remove());
    }

    // ATTACKS — lunge the attacker toward its target, then snap back. Fall
    // back to the previous frame's position when a card is gone from the new
    // frame — e.g. the target was defeated (→ discard) or the attacker traded.
    for (const { attackerUuid, targetUuid } of attacks) {
      const a = next.get(attackerUuid) ?? old.get(attackerUuid);
      const t = next.get(targetUuid!) ?? old.get(targetUuid!);
      if (!a || !t) continue;
      const dx = (t.x + t.w / 2 - (a.x + a.w / 2)) * 0.55;
      const dy = (t.y + t.h / 2 - (a.y + a.h / 2)) * 0.55;
      const liveEl = container.querySelector<HTMLElement>(`[data-card-uuid="${cssEscape(attackerUuid)}"]`);
      const clone = makeClone(a.html, rel(a), a.w, a.h);
      clone.style.zIndex = '10';
      overlay.appendChild(clone);
      if (liveEl) { liveEl.style.opacity = '0'; hidden.current.push(liveEl); }
      const anim = clone.animate(
        [
          { transform: 'translate(0,0) scale(1)', offset: 0 },
          { transform: `translate(${dx}px, ${dy}px) scale(1.08)`, offset: 0.42 },
          { transform: 'translate(0,0) scale(1)', offset: 1 },
        ],
        { duration: 440, easing: 'cubic-bezier(0.34, 1.2, 0.64, 1)' },
      );
      track(anim, () => { clone.remove(); if (liveEl) liveEl.style.opacity = ''; });

      // Hold the TARGET's OLD look (e.g. its prior damage) over the real card
      // until the lunge connects (~230ms), so the damage counter pops ON impact
      // rather than before. Only for a target that survives + sits still.
      const oldT = old.get(targetUuid!);
      const newT = next.get(targetUuid!);
      if (oldT && newT && oldT.html !== newT.html) {
        const tEl = container.querySelector<HTMLElement>(`[data-card-uuid="${cssEscape(targetUuid!)}"]`);
        const tClone = makeClone(oldT.html, rel(newT), newT.w, newT.h);
        overlay.appendChild(tClone);
        if (tEl) { tEl.style.opacity = '0'; hidden.current.push(tEl); }
        const hold = tClone.animate([{ opacity: 1 }, { opacity: 1 }], { duration: 230 });
        track(hold, () => { tClone.remove(); if (tEl) tEl.style.opacity = ''; });
      }
    }

    // PLAYS — slide the face-down card from hand to its arena slot, then flip
    // it over to reveal the played card.
    const PLAY_MOVE_MS = 420, PLAY_FLIP_MS = 280;
    for (const { played, hidden: hiddenUuid } of plays) {
      const from = old.get(hiddenUuid);
      const to = next.get(played);
      if (!from || !to) continue;
      const liveEl = container.querySelector<HTMLElement>(`[data-card-uuid="${cssEscape(played)}"]`);
      if (liveEl) { liveEl.style.opacity = '0'; hidden.current.push(liveEl); }

      const p = rel(to);
      const outer = document.createElement('div');
      Object.assign(outer.style, {
        position: 'absolute', left: `${p.left}px`, top: `${p.top}px`,
        width: `${to.w}px`, height: `${to.h}px`, transformOrigin: '0 0',
        pointerEvents: 'none', zIndex: '8',
      } as CSSStyleDeclaration);
      const inner = document.createElement('div');
      Object.assign(inner.style, { width: '100%', height: '100%', transformOrigin: 'center', position: 'relative' } as CSSStyleDeclaration);
      inner.appendChild(fitNode(from.html)); // face-down card to start
      outer.appendChild(inner);
      overlay.appendChild(outer);

      // MOVE the face-down card from `from` → `to`.
      const sx = from.w / to.w, sy = from.h / to.h, tx = from.x - to.x, ty = from.y - to.y;
      const moveAnim = outer.animate(
        [{ transform: `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})` }, { transform: 'translate(0,0) scale(1,1)' }],
        { duration: PLAY_MOVE_MS, fill: 'backwards', easing: EASING },
      );
      active.current.push(moveAnim);
      // FLIP after it lands; swap back→front at the edge-on midpoint.
      const flipAnim = inner.animate(
        [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0.04)' }, { transform: 'scaleX(1)' }],
        { duration: PLAY_FLIP_MS, delay: PLAY_MOVE_MS, fill: 'backwards', easing: 'ease-in-out' },
      );
      const swap = window.setTimeout(() => { inner.replaceChildren(fitNode(to.html)); }, PLAY_MOVE_MS + PLAY_FLIP_MS / 2);
      track(flipAnim, () => { window.clearTimeout(swap); outer.remove(); if (liveEl) liveEl.style.opacity = ''; });
    }
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

// Parse this frame's game log for attacks. karabast logs structured messages:
//   "{player} attacks {targetCard} with {attackerCard}"        (unit vs unit)
//   "{player} attacks {targetPlayer}'s base with {attackerCard}" (vs base)
// Each card/player part is an object with a `uuid`. The attacker is the card
// after "with"; the target is the part right after "attacks" (a card → unit
// target; a player → base target, resolved from the attacker's opponent).
function parseAttacks(state: any): { attackerUuid: string; targetUuid: string | null }[] {
  const out: { attackerUuid: string; targetUuid: string | null }[] = [];
  const msgs = Array.isArray(state?.newMessages) ? state.newMessages : [];
  for (const m of msgs) {
    const parts = m?.message;
    if (!Array.isArray(parts)) continue;
    const ai = parts.findIndex((p: any) => typeof p === 'string' && /attacks/i.test(p));
    if (ai < 0) continue;
    const cards = parts.filter((p: any) => p && typeof p === 'object' && p.type === 'card' && p.uuid);
    if (cards.length === 0) continue;
    const attacker = cards[cards.length - 1]; // the "with X" card
    const afterAttacks = parts[ai + 1];
    const targetUuid =
      afterAttacks && typeof afterAttacks === 'object' && afterAttacks.type === 'card'
        ? afterAttacks.uuid // unit target
        : null; // base target → resolved later
    out.push({ attackerUuid: attacker.uuid, targetUuid });
  }
  return out;
}

// A base attack's target = the base of the attacker's opponent.
function resolveBaseTarget(state: any, attackerUuid: string): string | null {
  const players = state?.players || {};
  let controllerId: string | null = null;
  for (const k of Object.keys(players)) {
    const piles = players[k]?.cardPiles || {};
    for (const z of Object.keys(piles)) {
      for (const c of piles[z] || []) {
        if (c?.uuid === attackerUuid) controllerId = c.controllerId;
      }
    }
  }
  if (!controllerId) return null;
  const oppKey = Object.keys(players).find((k) => k !== controllerId);
  return oppKey ? players[oppKey]?.base?.uuid ?? null : null;
}
