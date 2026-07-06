import { describe, it, expect } from 'vitest';
import { dateRangeBounds, inDateRange, dateRangeLabel } from './dateRange';

const NOW = new Date('2026-07-15T12:00:00Z');

describe('dateRange grammar', () => {
  it('empty → no bounds', () => {
    expect(dateRangeBounds('', NOW)).toEqual({ from: null, to: null });
    expect(dateRangeLabel('')).toBe('Any time');
  });

  it('rolling presets (with and without the d)', () => {
    const a = dateRangeBounds('30d', NOW);
    expect(a.from!.getTime()).toBe(NOW.getTime() - 30 * 86_400_000);
    expect(a.to).toBeNull();
    expect(dateRangeBounds('7', NOW).from!.getTime()).toBe(NOW.getTime() - 7 * 86_400_000); // legacy bare number
    expect(dateRangeLabel('90d')).toBe('Past 90 days');
  });

  it('explicit range, both ends; "to" is inclusive end-of-day', () => {
    const { from, to } = dateRangeBounds('2026-06-01..2026-06-30');
    expect(from!.getFullYear()).toBe(2026);
    expect(from!.getMonth()).toBe(5); // June
    expect(from!.getDate()).toBe(1);
    // end of June 30, not the start
    expect(to!.getDate()).toBe(30);
    expect(to!.getHours()).toBe(23);
    expect(dateRangeLabel('2026-06-01..2026-06-30')).toMatch(/–/);
  });

  it('open-ended ranges', () => {
    expect(dateRangeBounds('2026-06-01..').to).toBeNull();
    expect(dateRangeBounds('2026-06-01..').from).not.toBeNull();
    expect(dateRangeBounds('..2026-06-30').from).toBeNull();
    expect(dateRangeLabel('2026-06-01..')).toMatch(/^Since/);
    expect(dateRangeLabel('..2026-06-30')).toMatch(/^Until/);
  });

  it('inDateRange respects both bounds', () => {
    expect(inDateRange('2026-06-15', '2026-06-01..2026-06-30')).toBe(true);
    expect(inDateRange('2026-05-15', '2026-06-01..2026-06-30')).toBe(false);
    expect(inDateRange('2026-07-15', '2026-06-01..2026-06-30')).toBe(false);
    expect(inDateRange('2026-06-30T20:00:00', '2026-06-01..2026-06-30')).toBe(true); // inclusive end-of-day
  });

  it('unknown token → no-op (does not silently drop everything)', () => {
    expect(dateRangeBounds('garbage')).toEqual({ from: null, to: null });
    expect(inDateRange('2026-01-01', 'garbage')).toBe(true);
  });
});
