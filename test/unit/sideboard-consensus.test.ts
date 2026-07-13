import { describe, it, expect } from 'vitest';
import { computeConsensus } from '@/lib/sideboardGuides';

// B231: consensus = cards ranked by how many of a matchup's takes agree.
describe('computeConsensus', () => {
  it('ranks IN/OUT cards by agreement count across takes', () => {
    const takes = [
      { cardsIn: [{ cardId: 'A' }, { cardId: 'B' }], cardsOut: [{ cardId: 'X' }] },
      { cardsIn: [{ cardId: 'A' }], cardsOut: [{ cardId: 'X' }, { cardId: 'Y' }] },
      { cardsIn: [{ cardId: 'A' }, { cardId: 'C' }], cardsOut: [{ cardId: 'X' }] },
    ];
    const c = computeConsensus(takes);
    expect(c.total).toBe(3);
    expect(c.inCards[0]).toEqual({ cardId: 'A', count: 3 }); // unanimous first
    expect(c.inCards.map((x) => x.cardId)).toEqual(['A', 'B', 'C']); // ties by cardId
    expect(c.outCards[0]).toEqual({ cardId: 'X', count: 3 });
    expect(c.outCards.find((x) => x.cardId === 'Y')!.count).toBe(1);
  });

  it('counts presence per take, not copies (deduped within a take)', () => {
    const c = computeConsensus([{ cardsIn: [{ cardId: 'A' }, { cardId: 'A' }], cardsOut: [] }]);
    expect(c.inCards).toEqual([{ cardId: 'A', count: 1 }]);
  });

  it('empty -> zeros', () => {
    expect(computeConsensus([])).toEqual({ inCards: [], outCards: [], total: 0 });
  });
});
