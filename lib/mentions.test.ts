import { describe, expect, it } from 'vitest';
import { EMPTY_MENTIONS, normalizeMentions, sanitizeIncomingMentions } from './mentions';

// B55c — guards the structural mention contract the API depends on.
// If these change, every tag-write codepath is affected.
describe('normalizeMentions', () => {
  it('returns the empty struct for null / undefined / non-object', () => {
    expect(normalizeMentions(null)).toEqual(EMPTY_MENTIONS);
    expect(normalizeMentions(undefined)).toEqual(EMPTY_MENTIONS);
    expect(normalizeMentions('mentions')).toEqual(EMPTY_MENTIONS);
    expect(normalizeMentions(42)).toEqual(EMPTY_MENTIONS);
  });

  it('returns empty arrays for missing fields', () => {
    expect(normalizeMentions({})).toEqual({ userIds: [], teamSlugs: [] });
  });

  it('drops non-string entries from each list', () => {
    expect(normalizeMentions({ userIds: ['u1', 42, null, 'u2'], teamSlugs: [{}, 't1'] })).toEqual({
      userIds: ['u1', 'u2'],
      teamSlugs: ['t1'],
    });
  });
});

describe('sanitizeIncomingMentions', () => {
  it('de-dupes', () => {
    expect(sanitizeIncomingMentions({ userIds: ['u1', 'u1', 'u2'], teamSlugs: ['t1', 't1'] })).toEqual({
      userIds: ['u1', 'u2'],
      teamSlugs: ['t1'],
    });
  });

  it('caps oversized inputs (50 users / 10 teams)', () => {
    const big = sanitizeIncomingMentions({
      userIds: Array.from({ length: 100 }, (_, i) => `u${i}`),
      teamSlugs: Array.from({ length: 25 }, (_, i) => `t${i}`),
    });
    expect(big.userIds.length).toBe(50);
    expect(big.teamSlugs.length).toBe(10);
  });
});
