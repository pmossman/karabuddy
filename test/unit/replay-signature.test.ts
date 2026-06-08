import { describe, expect, it } from 'vitest';
import { frameSignature, mapFrameIndex } from '@/lib/replaySignature';

// A board state from one player's perspective. `handA`/`handB` let us vary the
// (perspective-specific) hands while keeping the public board identical.
const board = (opts: {
  phase?: string;
  g1?: { uuid: string; damage?: number }[];
  baseDmgP1?: number;
  handP1?: any[];
  handP2?: any[];
  resP1?: number;
}) => ({
  phase: opts.phase ?? 'action',
  players: {
    p1: {
      cardPiles: {
        hand: opts.handP1 ?? [],
        groundArena: opts.g1 ?? [],
        resources: Array.from({ length: opts.resP1 ?? 2 }, (_, i) => ({ uuid: `r${i}` })),
      },
      base: { damage: opts.baseDmgP1 ?? 0 },
      leader: { zone: 'base' },
    },
    p2: {
      cardPiles: { hand: opts.handP2 ?? [], groundArena: [], resources: [] },
      base: { damage: 0 },
      leader: { zone: 'base' },
    },
  },
});

describe('frameSignature', () => {
  it('hashes IDENTICALLY across the two POVs of the same board (hands/resources differ)', () => {
    // POV A: p1 hand visible (real cards), p2 hand masked stubs.
    const povA = board({ g1: [{ uuid: 'u1', damage: 1 }], handP1: [{ id: 'SOR_1' }, { id: 'SOR_2' }], handP2: [{ id: 'REPLAYHIDDEN_0' }] });
    // POV B: same board, but p2 hand visible + p1 hand masked, and p1 resource
    // identities differ (face-down, masked per POV). Public board is identical.
    const povB = board({ g1: [{ uuid: 'u1', damage: 1 }], handP1: [{ id: 'REPLAYHIDDEN_0' }, { id: 'REPLAYHIDDEN_1' }], handP2: [{ id: 'AOR_9' }] });
    expect(frameSignature(povA)).toBe(frameSignature(povB));
  });

  it('differs when the public board differs (unit damage)', () => {
    const a = board({ g1: [{ uuid: 'u1', damage: 1 }] });
    const b = board({ g1: [{ uuid: 'u1', damage: 3 }] });
    expect(frameSignature(a)).not.toBe(frameSignature(b));
  });

  it('differs on base damage and phase', () => {
    expect(frameSignature(board({ baseDmgP1: 0 }))).not.toBe(frameSignature(board({ baseDmgP1: 5 })));
    expect(frameSignature(board({ phase: 'action' }))).not.toBe(frameSignature(board({ phase: 'regroup' })));
  });

  it('is stable regardless of hand size (hand fully excluded)', () => {
    const few = board({ handP1: [{ id: 'X' }] });
    const many = board({ handP1: [{ id: 'X' }, { id: 'Y' }, { id: 'Z' }] });
    expect(frameSignature(few)).toBe(frameSignature(many));
  });
});

describe('mapFrameIndex', () => {
  const f = (sigState: any) => ({ state: sigState });
  it('lands on the frame with the matching signature', () => {
    const from = [f(board({ baseDmgP1: 0 })), f(board({ baseDmgP1: 5 }))];
    const to = [
      f(board({ baseDmgP1: 0 })),
      f(board({ baseDmgP1: 2 })),
      f(board({ baseDmgP1: 5 })), // matches from[1]
      f(board({ baseDmgP1: 9 })),
    ];
    expect(mapFrameIndex(from, 1, to)).toBe(2);
  });

  it('picks the proportionally-nearest among several signature matches', () => {
    const target = board({ baseDmgP1: 7 });
    const to = [f(board({ baseDmgP1: 7 })), f(board({ baseDmgP1: 0 })), f(board({ baseDmgP1: 7 }))];
    // from has 2 frames; fromIndex 1 → proportional target 1.0 → nearest match is index 2
    const from = [f(board({ baseDmgP1: 0 })), f(target)];
    expect(mapFrameIndex(from, 1, to)).toBe(2);
  });

  it('falls back to proportional when no signature matches', () => {
    const from = [f(board({ baseDmgP1: 0 })), f(board({ baseDmgP1: 1 })), f(board({ baseDmgP1: 2 })), f(board({ baseDmgP1: 3 }))];
    const to = [f(board({ baseDmgP1: 50 })), f(board({ baseDmgP1: 60 })), f(board({ baseDmgP1: 70 }))];
    // fromIndex 3 (last) → proportional 1.0 → last of `to`
    expect(mapFrameIndex(from, 3, to)).toBe(2);
    // fromIndex 0 → 0
    expect(mapFrameIndex(from, 0, to)).toBe(0);
  });

  it('handles empty target', () => {
    expect(mapFrameIndex([{ state: board({}) }], 0, [])).toBe(0);
  });
});
