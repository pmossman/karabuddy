import { describe, it, expect } from 'vitest';
import { nextSeriesGame, type SeriesInfo } from '@/app/(app)/r/[slug]/seriesTypes';

const series = (current: number, nums: number[]): SeriesInfo => ({
  current,
  games: nums.map((n) => ({ slug: `r_g${n}`, gameNumber: n })),
});

describe('nextSeriesGame', () => {
  it('returns the game after the current one', () => {
    expect(nextSeriesGame(series(1, [1, 2, 3]))).toEqual({ slug: 'r_g2', gameNumber: 2 });
    expect(nextSeriesGame(series(2, [1, 2, 3]))).toEqual({ slug: 'r_g3', gameNumber: 3 });
  });

  it('returns null on the last recorded game', () => {
    expect(nextSeriesGame(series(3, [1, 2, 3]))).toBeNull();
    // gap: current is the highest recorded even if the series could go longer
    expect(nextSeriesGame(series(2, [1, 2]))).toBeNull();
  });

  it('returns null for a non-series replay', () => {
    expect(nextSeriesGame(null)).toBeNull();
    expect(nextSeriesGame(undefined)).toBeNull();
  });

  it('tolerates out-of-order games arrays', () => {
    expect(nextSeriesGame(series(1, [3, 1, 2]))).toEqual({ slug: 'r_g2', gameNumber: 2 });
  });
});
