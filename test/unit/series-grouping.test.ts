import { describe, it, expect } from 'vitest';
import { segmentMatches, bestOfLabel, winsToWin, maxGames } from '@/lib/seriesGrouping';

// B158: a persistent karabast lobby can hold many matches; segment by format.

// Each game is just its win flag for these tests.
const seg = (results: (boolean | null)[], format: string | null) =>
  segmentMatches(results, (r) => r, format).map((m) => m.length);

describe('format helpers', () => {
  it('maps formats to wins-to-win, max games, labels', () => {
    expect(winsToWin('bestOfThree')).toBe(2);
    expect(maxGames('bestOfThree')).toBe(3);
    expect(winsToWin('bestOfOne')).toBe(1);
    expect(maxGames('bestOfOne')).toBe(1);
    expect(bestOfLabel('bestOfThree')).toBe('Best of 3');
    expect(bestOfLabel('bestOfOne')).toBe('Best of 1');
    expect(bestOfLabel('weird')).toBeNull();
    expect(bestOfLabel(null)).toBeNull();
  });
});

describe('segmentMatches — Bo3', () => {
  const BO3 = 'bestOfThree';
  it('a 2-0 closes at 2 games', () => {
    expect(seg([true, true], BO3)).toEqual([2]);
  });
  it('a 2-1 closes at 3 games', () => {
    expect(seg([true, false, true], BO3)).toEqual([3]);
  });
  it('a loss 1-2 closes when the opponent reaches 2', () => {
    expect(seg([true, false, false], BO3)).toEqual([3]);
  });
  it('splits several Bo3s in one lobby', () => {
    // 2-0 | 1-2 (opp at game 3) | 2-0
    expect(seg([true, true, false, true, false, true, true], BO3)).toEqual([2, 3, 2]);
  });
  it('an abandoned/unknown match is capped at N games', () => {
    expect(seg([null, null, null, null], BO3)).toEqual([3, 1]);
  });
});

describe('segmentMatches — Bo1', () => {
  it('makes every game its own match (no false "Best of 13" series)', () => {
    expect(seg([true, false, true, false], 'bestOfOne')).toEqual([1, 1, 1, 1]);
  });
});

describe('segmentMatches — unknown format', () => {
  it('falls back to single-game matches', () => {
    expect(seg([true, false], null)).toEqual([1, 1]);
  });
});
