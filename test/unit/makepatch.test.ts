import { describe, it, expect } from 'vitest';
import { makePatch, applyPatch } from '@/lib/replayDecoder';

// B120: the server-side forward diff must be the exact inverse of applyPatch —
// applyPatch(clone(a), makePatch(a, b)) deep-equals b — for the slice-merge
// re-diff to be lossless. Mirrors the extension recorder's makePatch
// (02-decoder.js); this battery is the behavioral parity guard.
const clone = (v: any) => JSON.parse(JSON.stringify(v));
const roundTrip = (a: any, b: any) => {
  const s = clone(a);
  applyPatch(s, makePatch(a, b));
  return s;
};

describe('makePatch ∘ applyPatch round-trip', () => {
  const cases: Array<[string, any, any]> = [
    ['identical', { a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } }],
    ['scalar change', { a: 1 }, { a: 2 }],
    ['nested change', { p: { x: 1, y: 2 } }, { p: { x: 1, y: 9 } }],
    ['added key', { a: 1 }, { a: 1, b: 2 }],
    ['added nested key', { p: { x: 1 } }, { p: { x: 1, z: 3 } }],
    ['array replaced wholesale', { arr: [1, 2, 3] }, { arr: [1, 9, 3, 4] }],
    ['object → scalar', { v: { x: 1 } }, { v: 5 }],
    ['scalar → object', { v: 5 }, { v: { x: 1 } }],
    ['deep gamestate-ish', {
      id: 'g', phase: 'action',
      players: { p1: { cardPiles: { groundArena: [{ uuid: 'a', damage: 0 }] } }, p2: { resources: 3 } },
    }, {
      id: 'g', phase: 'regroup',
      players: { p1: { cardPiles: { groundArena: [{ uuid: 'a', damage: 2 }] } }, p2: { resources: 4 } },
    }],
  ];
  for (const [name, a, b] of cases) {
    it(name, () => { expect(roundTrip(a, b)).toEqual(b); });
  }

  it('empty patch when unchanged', () => {
    expect(makePatch({ a: 1, b: 2 }, { a: 1, b: 2 })).toEqual({});
  });
});
