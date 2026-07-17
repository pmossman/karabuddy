import { describe, it, expect } from 'vitest';
import { detectDeckVersions, type ReplayList } from '@/lib/deckVersions';

const list = (main: [string, number][], side: [string, number][], t: number, win: boolean | null = null): ReplayList => ({
  main: main.map(([id, count]) => ({ id, count })),
  sideboard: side.map(([id, count]) => ({ id, count })),
  t, win,
});

describe('detectDeckVersions', () => {
  it('skips limited games (< 50-card maindeck)', () => {
    expect(detectDeckVersions([list([['a', 30]], [], 1)])).toEqual([]);
    expect(detectDeckVersions([])).toEqual([]);
  });

  it('groups consecutive identical registered sets into one version', () => {
    const v = detectDeckVersions([
      list([['a', 50]], [['b', 10]], 100, true),
      list([['a', 50]], [['b', 10]], 200, false),
    ]);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ label: 'v1', games: 2, wins: 1, losses: 1, size: 50, sideSize: 10 });
  });

  it('treats SIDEBOARDING (same combined set, different main/side split) as the SAME version', () => {
    const v = detectDeckVersions([
      list([['a', 50]], [['b', 10]], 100),           // combined a50 b10
      list([['a', 45], ['b', 5]], [['a', 5], ['b', 5]], 200), // combined a50 b10 — repartitioned
    ]);
    expect(v).toHaveLength(1);
    expect(v[0].games).toBe(2);
  });

  it('starts a NEW version when the registered set actually changes, with a diff', () => {
    const v = detectDeckVersions([
      list([['a', 50]], [['b', 10]], 100, true),   // v1: a50 b10
      list([['a', 50]], [['c', 10]], 200, true),   // v2: a50 c10  (−10 b, +10 c)
    ]);
    expect(v).toHaveLength(2);
    expect(v[0].diff).toBeNull();
    expect(v[1].diff!.added).toEqual([{ id: 'c', count: 10 }]);
    expect(v[1].diff!.removed).toEqual([{ id: 'b', count: 10 }]);
  });

  it('adding a sideboard to a no-sideboard deck is a real version change', () => {
    const v = detectDeckVersions([
      list([['a', 50]], [], 100),          // v1: 50 + 0 (Bo1 testing)
      list([['a', 50]], [['b', 10]], 200), // v2: 50 + 10 sideboard added
    ]);
    expect(v).toHaveLength(2);
    expect(v[0].sideSize).toBe(0);
    expect(v[1].sideSize).toBe(10);
    expect(v[1].diff!.added).toEqual([{ id: 'b', count: 10 }]);
  });

  it('orders versions by time regardless of input order', () => {
    const v = detectDeckVersions([
      list([['a', 50]], [['c', 10]], 300),
      list([['a', 50]], [['b', 10]], 100),
    ]);
    expect(v.map((x) => x.label)).toEqual(['v1', 'v2']);
    expect(v[0].startAt <= v[1].startAt).toBe(true);
  });
});
