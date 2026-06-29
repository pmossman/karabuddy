import { describe, it, expect, vi, afterEach } from 'vitest';
import { relativeTime, formatTimestamp } from '@/lib/datetime';
import { playerHandle, deckLabel } from '@/lib/players';
import { matchupVs, matchupTitle } from '@/lib/matchMetadata';

// B203: the consolidated formatting/handle/title helpers (were duplicated
// across ~30 components). matchupTitle is the riskiest (anonymize semantics).

describe('relativeTime', () => {
  afterEach(() => vi.useRealTimers());
  const at = (offsetMs: number) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-28T12:00:00Z'));
    return new Date(Date.now() - offsetMs).toISOString();
  };
  it('null/invalid → empty string', () => {
    expect(relativeTime(null)).toBe('');
    expect(relativeTime(undefined)).toBe('');
    expect(relativeTime('not-a-date')).toBe('');
  });
  it('buckets seconds/minutes/hours/days', () => {
    expect(relativeTime(at(10_000))).toBe('just now');
    expect(relativeTime(at(5 * 60_000))).toBe('5m ago');
    expect(relativeTime(at(3 * 3600_000))).toBe('3h ago');
    expect(relativeTime(at(2 * 86_400_000))).toBe('2d ago');
  });
  it('fallbackToDate switches to an absolute date past 7 days', () => {
    expect(relativeTime(at(3 * 86_400_000), { fallbackToDate: true })).toBe('3d ago');
    const old = relativeTime(at(10 * 86_400_000), { fallbackToDate: true });
    expect(old).not.toMatch(/ago$/);
    expect(old.length).toBeGreaterThan(0);
    // Without the option it stays "Nd ago".
    expect(relativeTime(at(10 * 86_400_000))).toBe('10d ago');
  });
});

describe('formatTimestamp', () => {
  it('null/invalid → empty string', () => {
    expect(formatTimestamp(null)).toBe('');
    expect(formatTimestamp('nope')).toBe('');
  });
  it('formats a valid timestamp; year:false drops the year; time:false drops the clock', () => {
    const full = formatTimestamp('2026-06-28T15:30:00Z');
    const noYear = formatTimestamp('2026-06-28T15:30:00Z', { year: false });
    const noTime = formatTimestamp('2026-06-28T15:30:00Z', { time: false });
    expect(full).toBeTruthy();
    expect(noYear.length).toBeLessThan(full.length); // year omitted
    expect(noTime.length).toBeLessThan(full.length); // clock omitted
    expect(noTime).not.toMatch(/:/); // date-only, no "h:mm"
  });
});

describe('playerHandle', () => {
  it('collapses missing/anonymous handles to "anon"', () => {
    expect(playerHandle(undefined)).toBe('anon');
    expect(playerHandle({})).toBe('anon');
    expect(playerHandle({ username: '' })).toBe('anon');
    expect(playerHandle({ username: 'anonymous 95d0c6' })).toBe('anon');
    expect(playerHandle({ username: 'Parker' })).toBe('Parker');
  });
});

describe('deckLabel', () => {
  const p = { leader: { name: 'Luke', set: 'SOR' }, base: { name: 'Echo Base' } };
  it('joins leader / base, optionally with the set code', () => {
    expect(deckLabel(null)).toBe('Unknown');
    expect(deckLabel(p)).toBe('Luke / Echo Base');
    expect(deckLabel(p, { withSet: true })).toBe('Luke (SOR) / Echo Base');
    expect(deckLabel({ leader: {}, base: {} })).toBe('Unknown / Unknown');
  });
});

describe('matchupVs / matchupTitle', () => {
  const players = [{ username: 'Parker', leader: { name: 'Boba' } }, { username: 'anonymous x', leader: { name: 'Luke' } }];
  it('matchupVs: handles by default, leaders when anonymized, "Replay" when empty', () => {
    expect(matchupVs({ players })).toBe('Parker vs anon');
    expect(matchupVs({ players }, { anonymize: true })).toBe('Boba vs Luke');
    expect(matchupVs({ players: [] })).toBe('Replay');
  });
  it('matchupTitle: a displayName wins, else falls back to matchupVs', () => {
    expect(matchupTitle({ displayName: 'Top 8 vs Cad', players })).toBe('Top 8 vs Cad');
    expect(matchupTitle({ displayName: null, players })).toBe('Parker vs anon');
    expect(matchupTitle({ players }, { anonymize: true })).toBe('Boba vs Luke');
  });
});
