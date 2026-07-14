import { describe, it, expect } from 'vitest';
import { computeConsensus, analyzeMatchupConsensus } from '@/lib/sideboardConsensus';

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
    expect(c.inCards[0]).toEqual({ cardId: 'A', count: 3, qty: 1 }); // unanimous first; qty defaults to 1
    expect(c.inCards.map((x) => x.cardId)).toEqual(['A', 'B', 'C']); // ties by cardId
    expect(c.outCards[0]).toEqual({ cardId: 'X', count: 3, qty: 1 });
    expect(c.outCards.find((x) => x.cardId === 'Y')!.count).toBe(1);
  });

  it('counts presence per take, not copies (deduped within a take)', () => {
    const c = computeConsensus([{ cardsIn: [{ cardId: 'A' }, { cardId: 'A' }], cardsOut: [] }]);
    expect(c.inCards).toEqual([{ cardId: 'A', count: 1, qty: 1 }]);
  });

  it('reports the typical (modal) quantity across takes; ties round up', () => {
    const c = computeConsensus([
      { cardsIn: [{ cardId: 'A', qty: 2 }], cardsOut: [] },
      { cardsIn: [{ cardId: 'A', qty: 2 }], cardsOut: [] },
      { cardsIn: [{ cardId: 'A', qty: 3 }], cardsOut: [] }, // 2 is modal
      { cardsIn: [{ cardId: 'B', qty: 1 }], cardsOut: [] },
      { cardsIn: [{ cardId: 'B', qty: 3 }], cardsOut: [] }, // tie 1v3 -> 3
    ]);
    expect(c.inCards.find((x) => x.cardId === 'A')).toEqual({ cardId: 'A', count: 3, qty: 2 });
    expect(c.inCards.find((x) => x.cardId === 'B')).toEqual({ cardId: 'B', count: 2, qty: 3 });
  });

  it('clamps qty to 1..3 via guideQty (out-of-range/absent -> 1)', () => {
    const c = computeConsensus([{ cardsIn: [{ cardId: 'A', qty: 9 }, { cardId: 'B', qty: 0 }], cardsOut: [] }]);
    expect(c.inCards.find((x) => x.cardId === 'A')!.qty).toBe(3);
    expect(c.inCards.find((x) => x.cardId === 'B')!.qty).toBe(1);
  });

  it('empty -> zeros', () => {
    expect(computeConsensus([])).toEqual({ inCards: [], outCards: [], total: 0 });
  });
});

// The member-attributed view: THE PLAN (unanimous only) + SPLIT (the rest, with names).
const take = (id: string, cin: any[], cout: any[] = []) => ({ authorId: id, authorName: id.toUpperCase(), cardsIn: cin, cardsOut: cout });

describe('analyzeMatchupConsensus', () => {
  it('a card is PLAN only when every member points the same way (unanimous)', () => {
    const a = analyzeMatchupConsensus([
      take('a', [{ cardId: 'NINTH', qty: 2 }], [{ cardId: 'MECH' }]),
      take('b', [{ cardId: 'NINTH', qty: 2 }], [{ cardId: 'MECH' }]),
      take('c', [{ cardId: 'NINTH', qty: 3 }], [{ cardId: 'MECH' }]),
    ]);
    expect(a.total).toBe(3);
    expect(a.planIn).toEqual([{ cardId: 'NINTH', qty: 2 }]); // modal qty (2,2,3 -> 2)
    expect(a.planOut).toEqual([{ cardId: 'MECH', qty: 1 }]);
    expect(a.split).toEqual([]);
  });

  it('a non-unanimous card is SPLIT with the members who picked it', () => {
    const a = analyzeMatchupConsensus([
      take('a', [{ cardId: 'RAID' }]),
      take('b', [{ cardId: 'RAID' }]),
      take('c', [{ cardId: 'CONF' }]),
    ]);
    expect(a.planIn).toEqual([]); // nothing unanimous
    const raid = a.split.find((s) => s.cardId === 'RAID')!;
    expect(raid.inMembers.map((m) => m.id).sort()).toEqual(['a', 'b']);
    expect(raid.outMembers).toEqual([]);
    expect(raid.contested).toBe(false);
  });

  it('a card some bring in and some cut is CONTESTED, sorted first', () => {
    const a = analyzeMatchupConsensus([
      take('a', [{ cardId: 'IG' }], []),          // a: IG in
      take('b', [], [{ cardId: 'IG' }]),          // b: IG out  -> contested
      take('c', [{ cardId: 'SOLO' }], []),        // c: SOLO in (minority)
    ]);
    expect(a.split[0].cardId).toBe('IG');         // contested first
    expect(a.split[0].contested).toBe(true);
    expect(a.split[0].inMembers.map((m) => m.id)).toEqual(['a']);
    expect(a.split[0].outMembers.map((m) => m.id)).toEqual(['b']);
    expect(a.split.find((s) => s.cardId === 'SOLO')!.contested).toBe(false);
  });

  it('a single member: all their picks are the plan (1/1 is unanimous)', () => {
    const a = analyzeMatchupConsensus([take('a', [{ cardId: 'X' }], [{ cardId: 'Y' }])]);
    expect(a.planIn).toEqual([{ cardId: 'X', qty: 1 }]);
    expect(a.planOut).toEqual([{ cardId: 'Y', qty: 1 }]);
    expect(a.split).toEqual([]);
  });

  it('empty -> zeros', () => {
    expect(analyzeMatchupConsensus([])).toEqual({ total: 0, planIn: [], planOut: [], split: [] });
  });
});
