import { describe, it, expect } from 'vitest';
import { multisetContains, multisetOverlap, multisetEquals } from '@/lib/multiset';

describe('multiset helpers', () => {
  it('multisetContains counts duplicates', () => {
    expect(multisetContains(['a', 'b', 'c'], ['a', 'b'])).toBe(true);
    expect(multisetContains(['a', 'a', 'b'], ['a', 'a'])).toBe(true);
    // pool has only one 'a' but two are asked for
    expect(multisetContains(['a', 'b'], ['a', 'a'])).toBe(false);
    expect(multisetContains(['a', 'b'], ['c'])).toBe(false);
    expect(multisetContains([], [])).toBe(true);
  });

  it('multisetOverlap matches each pool entry at most once', () => {
    expect(multisetOverlap(['a', 'b'], ['a', 'b', 'c'])).toBe(2);
    expect(multisetOverlap(['a', 'a'], ['a', 'b'])).toBe(1); // only one 'a' in b
    expect(multisetOverlap(['a', 'a'], ['a', 'a'])).toBe(2);
    expect(multisetOverlap(['x'], ['y'])).toBe(0);
  });

  it('multisetEquals is order-insensitive but multiplicity-aware', () => {
    expect(multisetEquals(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(multisetEquals(['a', 'a'], ['a', 'b'])).toBe(false);
    expect(multisetEquals(['a'], ['a', 'a'])).toBe(false);
  });
});
