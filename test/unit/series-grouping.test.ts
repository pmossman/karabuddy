import { describe, it, expect } from 'vitest';
import { segmentMatches, effectiveFormats, bestOfLabel, winsToWin, maxGames } from '@/lib/seriesGrouping';

// B158/B224: a persistent karabast lobby can hold many matches; segment by
// format, conversion-aware.

// A game is [wonFlag, recordedFormat]; the helper segments and reports sizes.
type G = [boolean | null, string | null];
const seg = (games: G[]) =>
  segmentMatches(games, (g) => g[0], (g) => g[1]).map((m) => m.games.length);
// Uniform-format helper: every game recorded with the same mode.
const segF = (results: (boolean | null)[], format: string | null) =>
  seg(results.map((r) => [r, format] as G));

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
    expect(segF([true, true], BO3)).toEqual([2]);
  });
  it('a 2-1 closes at 3 games', () => {
    expect(segF([true, false, true], BO3)).toEqual([3]);
  });
  it('a loss 1-2 closes when the opponent reaches 2', () => {
    expect(segF([true, false, false], BO3)).toEqual([3]);
  });
  it('splits several Bo3s in one lobby', () => {
    // 2-0 | 1-2 (opp at game 3) | 2-0
    expect(segF([true, true, false, true, false, true, true], BO3)).toEqual([2, 3, 2]);
  });
  it('an abandoned/unknown match is capped at N games', () => {
    expect(segF([null, null, null, null], BO3)).toEqual([3, 1]);
  });
});

describe('segmentMatches — Bo1', () => {
  it('makes every game its own match (no false "Best of 13" series)', () => {
    expect(segF([true, false, true, false], 'bestOfOne')).toEqual([1, 1, 1, 1]);
  });
});

describe('segmentMatches — unknown format', () => {
  it('falls back to single-game matches', () => {
    expect(segF([true, false], null)).toEqual([1, 1]);
  });
});

describe('segmentMatches — Bo1→Bo3 conversion (B224)', () => {
  const O = 'bestOfOne';
  const T = 'bestOfThree';
  it('a converted 2-0 set: [bo1(win), bo3(win)] is ONE Bo3', () => {
    expect(seg([[true, O], [true, T]])).toEqual([2]);
    // and it's labeled Bo3, not Bo1
    const [m] = segmentMatches([[true, O], [true, T]] as G[], (g) => g[0], (g) => g[1]);
    expect(m.format).toBe('bestOfThree');
  });
  it('a converted 2-1 set: [bo1(win), bo3(loss), bo3(win)] is ONE Bo3', () => {
    expect(seg([[true, O], [false, T], [true, T]])).toEqual([3]);
  });
  it('a standalone Bo1 then a converted Bo3: [bo1, bo1→bo3, bo3]', () => {
    // game 1 is bo1 followed by bo1 → standalone; game 2 is bo1 followed by
    // bo3 → converted game 1; games 2+3 form the Bo3.
    expect(seg([[true, O], [true, O], [true, T]])).toEqual([1, 2]);
    const ms = segmentMatches([[true, O], [true, O], [true, T]] as G[], (g) => g[0], (g) => g[1]);
    expect(ms.map((m) => m.format)).toEqual(['bestOfOne', 'bestOfThree']);
  });
  it('two converted Bo3 sets back to back', () => {
    // [bo1,bo3,bo3 | bo1,bo3] → a 2-1 set then a converted 2-0 set
    expect(seg([[true, O], [false, T], [true, T], [false, O], [false, T]])).toEqual([3, 2]);
  });
});

describe('effectiveFormats', () => {
  it('reports the per-game match format (conversion-aware)', () => {
    const games: G[] = [[true, 'bestOfOne'], [true, 'bestOfThree'], [true, 'bestOfOne']];
    // game 1 = converted Bo3 (followed by bo3), game 2 = bo3, game 3 = standalone bo1
    expect(effectiveFormats(games, (g) => g[0], (g) => g[1])).toEqual([
      'bestOfThree', 'bestOfThree', 'bestOfOne',
    ]);
  });
});
