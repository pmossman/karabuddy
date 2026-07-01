import { describe, expect, it } from 'vitest';
import { computeActionStops, nextActionStop } from '@/app/(app)/r/[slug]/actionStops';

// Frame builder: active player + each player's pile sizes (+ optional log lines
// that became NEW on this frame, as the karabast {message:[...]} shape).
type PP = { deck?: number; hand?: number; resources?: number; discard?: number };
function frame(active: string | null, p1: PP, p2: PP, msgs: string[] = []) {
  const piles = (p: PP) => ({
    cardPiles: {
      deck: Array(p.deck ?? 0).fill({}),
      hand: Array(p.hand ?? 0).fill({}),
      resources: Array(p.resources ?? 0).fill({}),
      discard: Array(p.discard ?? 0).fill({}),
    },
  });
  return {
    state: {
      players: { p1: piles(p1), p2: piles(p2) },
      newMessages: msgs.map((m) => ({ message: [m] })),
    },
    active,
  };
}
const stopsOf = (fs: ReturnType<typeof frame>[]) =>
  computeActionStops(fs, fs.map((f) => f.active));

describe('computeActionStops', () => {
  it('stops on active-player changes (the original behavior)', () => {
    const fs = [
      frame('p1', { deck: 30 }, { deck: 30 }), // 0
      frame('p1', { deck: 30 }, { deck: 30 }), // 1 (no change)
      frame('p2', { deck: 30 }, { deck: 30 }), // 2 active flip
      frame('p1', { deck: 30 }, { deck: 30 }), // 3 active flip
    ];
    expect(stopsOf(fs)).toEqual([0, 2, 3]); // 0 + flips + last(==3)
  });

  it('adds a stop when a player draws, resources, or discards within a segment', () => {
    // The deck is masked (always 0 cards), so a DRAW reads as the hand growing.
    const fs = [
      frame(null, { hand: 6 }, { hand: 6 }), // 0 start
      frame(null, { hand: 8 }, { hand: 6 }), // 1 p1 drew (hand 6→8)
      frame(null, { hand: 7, resources: 1 }, { hand: 6 }), // 2 p1 resourced (res 0→1)
      frame(null, { hand: 7, resources: 1 }, { hand: 8 }), // 3 p2 drew (hand 6→8)
      frame(null, { hand: 7, resources: 1 }, { hand: 7, discard: 1 }), // 4 p2 discarded
    ];
    // No active-player changes here (all null) — every beat is a draw/resource/discard.
    expect(stopsOf(fs)).toEqual([0, 1, 2, 3, 4]);
  });

  it('does NOT stop on a plain play (hand shrinks, no draw/discard/resource)', () => {
    const fs = [
      frame('p1', { hand: 7 }, {}), // 0
      frame('p1', { hand: 6 }, {}), // 1 played a card (hand 7→6) — not a stop on its own
      frame('p1', { hand: 6 }, {}), // 2
    ];
    expect(stopsOf(fs)).toEqual([0, 2]); // only start + last; frame 1 is skipped
  });

  it('stops on a mulligan decision even though no pile grows and no active flip', () => {
    // Setup phase: karabast sets no active player, and a "keep"/"mulligan"
    // decision moves no pile counts — only the game log marks it (B217).
    const fs = [
      frame(null, { hand: 6 }, { hand: 6 }), // 0 opening hands
      frame(null, { hand: 6 }, { hand: 6 }, ['Alice will keep their hand']), // 1 decision
      frame(null, { hand: 6 }, { hand: 6 }, ['Bob will mulligan']),          // 2 decision
      frame(null, { hand: 6 }, { hand: 6 }), // 3 (nothing new)
    ];
    expect(stopsOf(fs)).toEqual([0, 1, 2, 3]); // 0 + both decisions + last(==3)
  });

  it('stops on a resourcing decision from the log', () => {
    // "has not resourced any cards" grows no pile — only the log marks it. Put a
    // trailing frame after it so it isn't a stop merely for being last.
    const fs = [
      frame(null, { hand: 6 }, { hand: 6 }), // 0
      frame(null, { hand: 4, resources: 2 }, { hand: 6 }, ['Alice has resourced 2 cards from hand']), // 1
      frame(null, { hand: 4, resources: 2 }, { hand: 6 }, ['Bob has not resourced any cards']),        // 2 (no pile change)
      frame(null, { hand: 4, resources: 2 }, { hand: 6 }), // 3 trailing
    ];
    expect(stopsOf(fs)).toEqual([0, 1, 2, 3]);
  });

  it('does NOT re-trip on a cumulative log (decision counts once)', () => {
    // newMessages may be cumulative — the same line shows on every later frame.
    // Only the frame where it's NEWLY added is a stop (delta vs the prior frame).
    const mk = (active: string | null, msgs: string[]) => ({
      state: {
        players: { p1: { cardPiles: { hand: Array(6).fill({}) } }, p2: { cardPiles: { hand: Array(6).fill({}) } } },
        newMessages: msgs.map((m) => ({ message: [m] })),
      },
      active,
    });
    const fs = [
      mk(null, []),                                 // 0
      mk(null, ['Alice will mulligan']),            // 1 decision appears
      mk(null, ['Alice will mulligan']),            // 2 same line still present — NOT a new stop
      mk(null, ['Alice will mulligan', 'Bob will keep their hand']), // 3 Bob's decision is new
    ];
    expect(computeActionStops(fs, fs.map((f) => f.active))).toEqual([0, 1, 3]);
  });

  it('ignores unrelated log lines', () => {
    const fs = [
      frame(null, { hand: 6 }, { hand: 6 }), // 0
      frame(null, { hand: 6 }, { hand: 6 }, ['Alice is shuffling their deck']), // 1 — not a decision
      frame(null, { hand: 6 }, { hand: 6 }, ['Alice draws 6 cards in their starting hand']), // 2 — not a decision
    ];
    expect(stopsOf(fs)).toEqual([0, 2]); // only start + last; frame 1 skipped
  });

  it('finds the next/prev stop and is symmetric across a step', () => {
    const stops = [0, 2, 3, 7];
    expect(nextActionStop(stops, 0, 1)).toBe(2);
    expect(nextActionStop(stops, 2, 1)).toBe(3);
    expect(nextActionStop(stops, 3, -1)).toBe(2); // forward 2→3 then back 3→2
    expect(nextActionStop(stops, 5, -1)).toBe(3); // mid → prev stop
    expect(nextActionStop(stops, 7, 1)).toBe(7);  // clamp at end
    expect(nextActionStop(stops, 0, -1)).toBe(0); // clamp at start
  });

  it('returns [] / no-op for empty input', () => {
    expect(computeActionStops([], [])).toEqual([]);
    expect(nextActionStop([], 3, 1)).toBe(3);
  });
});
