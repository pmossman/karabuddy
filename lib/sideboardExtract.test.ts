import { describe, it, expect } from 'vitest';
import { computeSwap } from './sideboardExtract';

const c = (id: string, count: number) => ({ id, count });

describe('computeSwap', () => {
  it('a clean 2-for-2 swap', () => {
    const before = [c('A', 3), c('B', 3), c('C', 2)];
    const after = [c('A', 1), c('B', 3), c('C', 2), c('D', 2)]; // -2 A, +2 D
    expect(computeSwap(before, after)).toEqual({ swappedIn: ['D', 'D'], swappedOut: ['A', 'A'] });
  });

  it('kept the same deck → empty swap', () => {
    const deck = [c('A', 3), c('B', 2)];
    expect(computeSwap(deck, deck)).toEqual({ swappedIn: [], swappedOut: [] });
  });

  it('counts partial copy changes (3 → 1 = out 2)', () => {
    expect(computeSwap([c('A', 3)], [c('A', 1), c('B', 2)])).toEqual({ swappedIn: ['B', 'B'], swappedOut: ['A', 'A'] });
  });

  it('sorts for stable storage', () => {
    const r = computeSwap([c('Z', 2), c('Y', 2)], [c('M', 1), c('N', 1), c('Y', 2)]); // out Z Z, in M N
    expect(r.swappedIn).toEqual(['M', 'N']);
    expect(r.swappedOut).toEqual(['Z', 'Z']);
  });
});
