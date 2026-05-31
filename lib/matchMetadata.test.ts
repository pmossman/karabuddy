import { describe, it, expect } from 'vitest';
import { matchChips } from './matchMetadata';

// B79: pure chip-composer for the replay match-metadata row.

describe('matchChips', () => {
  it('composes format / pool / mode in a stable order', () => {
    expect(matchChips({ gameFormat: 'premier', cardPool: 'unlimited', gamesToWinMode: 'bestOfThree' }))
      .toEqual(['Premier', 'Unlimited', 'Bo3']);
  });
  it('suppresses the default cardPool ("current") as noise', () => {
    expect(matchChips({ gameFormat: 'eternal', cardPool: 'current', gamesToWinMode: 'bestOfOne' }))
      .toEqual(['Eternal', 'Bo1']);
  });
  it('drops unknown values and returns [] for null/empty meta', () => {
    expect(matchChips({ gameFormat: 'mystery' })).toEqual([]);
    expect(matchChips(null)).toEqual([]);
    expect(matchChips(undefined)).toEqual([]);
    expect(matchChips({})).toEqual([]);
  });
});
