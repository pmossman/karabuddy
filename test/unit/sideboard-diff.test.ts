import { describe, expect, it } from 'vitest';
import { sideboardDiff } from '@/lib/sideboardDiff';
import type { DeckCardRef } from '@/lib/replayDecoder';

const c = (id: string, count: number, cost?: number): DeckCardRef => ({ id, count, cost: cost ?? null });

describe('sideboardDiff', () => {
  it('reports cards swapped in and out with delta counts, symmetric by total', () => {
    const prev = [c('A', 3, 2), c('B', 2, 4), c('C', 2, 6)];
    const cur = [c('A', 1, 2), c('B', 2, 4), c('D', 3, 1), c('C', 1, 6)];
    const d = sideboardDiff(prev, cur)!;
    expect(d.changed).toBe(true);
    // out: A -2, C -1 (total 3) ; in: D +3 (total 3)
    expect(d.out).toEqual([{ id: 'A', count: 2, cost: 2, internalName: null }, { id: 'C', count: 1, cost: 6, internalName: null }]);
    expect(d.in).toEqual([{ id: 'D', count: 3, cost: 1, internalName: null }]);
    const tIn = d.in.reduce((s, x) => s + x.count, 0), tOut = d.out.reduce((s, x) => s + x.count, 0);
    expect(tIn).toBe(tOut); // deck size constant → in total == out total
  });

  it('sorts both lists by cost then id', () => {
    const prev = [c('Z', 1, 5), c('Y', 1, 1)];
    const cur = [c('M', 1, 3), c('N', 1, 1)];
    const d = sideboardDiff(prev, cur)!;
    expect(d.in.map((x) => x.id)).toEqual(['N', 'M']);   // cost 1 before cost 3
    expect(d.out.map((x) => x.id)).toEqual(['Y', 'Z']);  // cost 1 before cost 5
  });

  it('changed=false when the decks are identical', () => {
    const same = [c('A', 3), c('B', 2)];
    const d = sideboardDiff(same, [...same.map((x) => ({ ...x }))])!;
    expect(d.changed).toBe(false);
    expect(d.in).toEqual([]);
    expect(d.out).toEqual([]);
  });

  it('handles a partial-count change (3 → 2 of the same card)', () => {
    const d = sideboardDiff([c('A', 3, 2)], [c('A', 2, 2), c('B', 1, 1)])!;
    expect(d.out).toEqual([{ id: 'A', count: 1, cost: 2, internalName: null }]);
    expect(d.in).toEqual([{ id: 'B', count: 1, cost: 1, internalName: null }]);
  });

  it('returns null when either deck is unavailable (opponent masked)', () => {
    expect(sideboardDiff(null, [c('A', 1)])).toBeNull();
    expect(sideboardDiff([c('A', 1)], null)).toBeNull();
  });
});
