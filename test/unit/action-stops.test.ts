import { describe, expect, it } from 'vitest';
import { computeActionStops, nextActionStop } from '@/app/(app)/r/[slug]/actionStops';

// Frame builder: active player + each player's pile sizes.
type PP = { deck?: number; hand?: number; resources?: number; discard?: number };
function frame(active: string | null, p1: PP, p2: PP) {
  const piles = (p: PP) => ({
    cardPiles: {
      deck: Array(p.deck ?? 0).fill({}),
      hand: Array(p.hand ?? 0).fill({}),
      resources: Array(p.resources ?? 0).fill({}),
      discard: Array(p.discard ?? 0).fill({}),
    },
  });
  return { state: { players: { p1: piles(p1), p2: piles(p2) } }, active };
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
