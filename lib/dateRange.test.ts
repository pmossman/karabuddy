import { describe, it, expect } from 'vitest';
import { dateRangeBounds, dateRangeFilter, inDateRange, dateRangeLabel, isDayRange, normalizeTimeZone, localTimeZone } from './dateRange';

const NOW = new Date('2026-07-15T12:00:00Z');
const LA = 'America/Los_Angeles';
const UTC = 'UTC';
const iso = (d: Date | null) => d?.toISOString() ?? null;
const bounds = (v: string, timeZone: string) => {
  const { from, to } = dateRangeBounds(v, { timeZone, now: NOW });
  return { from: iso(from), to: iso(to) };
};
const HOUR = 3_600_000;

describe('dateRange grammar', () => {
  it('empty → no bounds', () => {
    expect(dateRangeBounds('', { timeZone: LA, now: NOW })).toEqual({ from: null, to: null });
    expect(dateRangeLabel('')).toBe('Any time');
  });

  it('rolling presets (with and without the d) stay relative to now, in every zone', () => {
    for (const timeZone of [UTC, LA, 'Asia/Tokyo']) {
      const a = dateRangeBounds('30d', { timeZone, now: NOW });
      expect(a.from!.getTime()).toBe(NOW.getTime() - 30 * 86_400_000);
      expect(a.to).toBeNull();
      expect(dateRangeBounds('7', { timeZone, now: NOW }).from!.getTime()).toBe(NOW.getTime() - 7 * 86_400_000); // legacy bare number
    }
    expect(dateRangeLabel('90d')).toBe('Past 90 days');
  });

  it('explicit range = whole local days, "to" inclusive to the last ms before the next local midnight', () => {
    expect(bounds('2026-06-01..2026-06-30', LA)).toEqual({ from: '2026-06-01T07:00:00.000Z', to: '2026-07-01T06:59:59.999Z' });
    expect(bounds('2026-06-01..2026-06-30', UTC)).toEqual({ from: '2026-06-01T00:00:00.000Z', to: '2026-06-30T23:59:59.999Z' });
    expect(dateRangeLabel('2026-06-01..2026-06-30')).toMatch(/–/);
  });

  it('open-ended ranges', () => {
    expect(bounds('2026-06-01..', LA)).toEqual({ from: '2026-06-01T07:00:00.000Z', to: null });
    expect(bounds('..2026-06-30', LA)).toEqual({ from: null, to: '2026-07-01T06:59:59.999Z' });
    expect(dateRangeLabel('2026-06-01..')).toMatch(/^Since/);
    expect(dateRangeLabel('..2026-06-30')).toMatch(/^Until/);
  });

  it('a US-evening game counts on the local day it was played, not the UTC day (the eruletho report)', () => {
    // Played 2026-10-06 18:28–23:29 PDT = 2026-10-07 01:28–06:29 UTC.
    const games = ['2026-10-07T01:28:00Z', '2026-10-07T03:00:00Z', '2026-10-07T06:29:00Z'];
    for (const g of games) {
      expect(inDateRange(g, '2026-10-06..2026-10-06', { timeZone: LA })).toBe(true);
      expect(inDateRange(g, '2026-10-07..2026-10-07', { timeZone: LA })).toBe(false);
      // Read as UTC days (what the server did before) they land on "tomorrow".
      expect(inDateRange(g, '2026-10-06..2026-10-06', { timeZone: UTC })).toBe(false);
      expect(inDateRange(g, '2026-10-07..2026-10-07', { timeZone: UTC })).toBe(true);
    }
  });

  it('a UTC+ zone: the local day starts the previous UTC evening', () => {
    expect(bounds('2026-10-06..2026-10-06', 'Asia/Tokyo')).toEqual({ from: '2026-10-05T15:00:00.000Z', to: '2026-10-06T14:59:59.999Z' });
    expect(bounds('2026-10-06..2026-10-06', 'Asia/Kolkata')).toEqual({ from: '2026-10-05T18:30:00.000Z', to: '2026-10-06T18:29:59.999Z' });
    // 01:00 on Oct 7 in Tokyo is still Oct 6 in UTC.
    expect(inDateRange('2026-10-06T16:00:00Z', '2026-10-06..2026-10-06', { timeZone: 'Asia/Tokyo' })).toBe(false);
    expect(inDateRange('2026-10-06T16:00:00Z', '2026-10-07..2026-10-07', { timeZone: 'Asia/Tokyo' })).toBe(true);
    expect(inDateRange('2026-10-06T16:00:00Z', '2026-10-06..2026-10-06', { timeZone: UTC })).toBe(true);
  });

  it('a range spanning a DST change still means whole local days', () => {
    // US spring-forward is 2026-03-08: PST (-8) on the 7th, PDT (-7) by the 9th.
    expect(bounds('2026-03-07..2026-03-09', LA)).toEqual({ from: '2026-03-07T08:00:00.000Z', to: '2026-03-10T06:59:59.999Z' });
    // The DST days themselves are 23 and 25 hours long.
    const len = (v: string, tz: string) => { const b = dateRangeBounds(v, { timeZone: tz }); return b.to!.getTime() + 1 - b.from!.getTime(); };
    expect(len('2026-03-08..2026-03-08', LA)).toBe(23 * HOUR);
    expect(len('2026-11-01..2026-11-01', LA)).toBe(25 * HOUR);
    // Southern hemisphere: Sydney springs forward on 2026-10-04 (+10 → +11).
    expect(bounds('2026-10-03..2026-10-04', 'Australia/Sydney')).toEqual({ from: '2026-10-02T14:00:00.000Z', to: '2026-10-04T12:59:59.999Z' });
    expect(len('2026-03-29..2026-03-29', 'Europe/London')).toBe(23 * HOUR);
  });

  it('zones whose DST change happens AT midnight', () => {
    // Santiago skips 2026-09-06 00:00 (clocks jump to 01:00 at 04:00Z): the day starts when they jump.
    expect(bounds('2026-09-06..2026-09-06', 'America/Santiago')).toEqual({ from: '2026-09-06T04:00:00.000Z', to: '2026-09-07T02:59:59.999Z' });
    expect(bounds('2026-09-05..2026-09-05', 'America/Santiago').to).toBe('2026-09-06T03:59:59.999Z'); // and the day before ends there
    // Havana repeats midnight on 2026-11-01 (01:00 EDT → 00:00 CST): the day starts at its FIRST midnight.
    expect(bounds('2026-11-01..2026-11-01', 'America/Havana')).toEqual({ from: '2026-11-01T04:00:00.000Z', to: '2026-11-02T04:59:59.999Z' });
    // …and skips it on 2026-03-08.
    expect(bounds('2026-03-08..2026-03-08', 'America/Havana').from).toBe('2026-03-08T05:00:00.000Z');
  });

  it('a missing or bogus time zone falls back to UTC days', () => {
    const utc = bounds('2026-10-06..2026-10-06', UTC);
    for (const bad of ['', 'Mars/Olympus_Mons', 'not a zone', '+05:00', 'America/Los_Angeles; drop', 'A'.repeat(65)]) {
      expect(normalizeTimeZone(bad)).toBe('UTC');
      expect(bounds('2026-10-06..2026-10-06', bad)).toEqual(utc);
    }
    expect(normalizeTimeZone(null)).toBe('UTC');
    expect(normalizeTimeZone(undefined)).toBe('UTC');
    expect(normalizeTimeZone(42 as unknown as string)).toBe('UTC');
  });

  it('normalizeTimeZone canonicalizes valid names (one cache key per zone)', () => {
    expect(normalizeTimeZone('America/Los_Angeles')).toBe('America/Los_Angeles');
    expect(normalizeTimeZone('america/los_angeles')).toBe('America/Los_Angeles');
    expect(normalizeTimeZone('Etc/GMT+5')).toBe('Etc/GMT+5');
    expect(normalizeTimeZone(localTimeZone())).toBe(localTimeZone());
  });

  it('isDayRange: only calendar-day values depend on the zone', () => {
    for (const v of ['', '7', '30d', 'garbage', '..', '2026-13-01..']) expect(isDayRange(v)).toBe(false);
    for (const v of ['2026-06-01..2026-06-30', '2026-06-01..', '..2026-06-30']) expect(isDayRange(v)).toBe(true);
  });

  it('inDateRange / dateRangeFilter respect both bounds', () => {
    const opts = { timeZone: LA };
    expect(inDateRange('2026-06-15T12:00:00Z', '2026-06-01..2026-06-30', opts)).toBe(true);
    expect(inDateRange('2026-05-15T12:00:00Z', '2026-06-01..2026-06-30', opts)).toBe(false);
    expect(inDateRange('2026-07-15T12:00:00Z', '2026-06-01..2026-06-30', opts)).toBe(false);
    expect(inDateRange('2026-07-01T06:59:59Z', '2026-06-01..2026-06-30', opts)).toBe(true); // inclusive end of the local day
    expect(inDateRange('2026-07-01T07:00:00Z', '2026-06-01..2026-06-30', opts)).toBe(false);
    const inJune = dateRangeFilter('2026-06-01..2026-06-30', opts);
    expect(['2026-06-01T07:00:00Z', '2026-06-01T06:59:59Z', 'not a date'].map(inJune)).toEqual([true, false, false]);
  });

  it('unknown token → no-op (does not silently drop everything)', () => {
    expect(dateRangeBounds('garbage', { timeZone: LA })).toEqual({ from: null, to: null });
    expect(inDateRange('2026-01-01T00:00:00Z', 'garbage', { timeZone: LA })).toBe(true);
  });
});
