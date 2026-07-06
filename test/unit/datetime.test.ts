import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { coarseAge } from '@/lib/datetime';

// Fixed "now" so the day/week/month/year buckets are deterministic.
const NOW = new Date('2026-07-06T12:00:00Z').getTime();
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

describe('coarseAge', () => {
  beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterAll(() => { vi.useRealTimers(); });

  it('buckets into the largest sensible unit', () => {
    expect(coarseAge(ago(0))).toBe('today');
    expect(coarseAge(ago(1))).toBe('yesterday');
    expect(coarseAge(ago(3))).toBe('3 days ago');
    expect(coarseAge(ago(9))).toBe('1 week ago');
    expect(coarseAge(ago(21))).toBe('3 weeks ago');
    expect(coarseAge(ago(45))).toBe('1 month ago');
    expect(coarseAge(ago(200))).toBe('6 months ago');
    expect(coarseAge(ago(400))).toBe('1 year ago');
    expect(coarseAge(ago(800))).toBe('2 years ago');
  });

  it('handles null/invalid', () => {
    expect(coarseAge(null)).toBe('');
    expect(coarseAge(undefined)).toBe('');
    expect(coarseAge('not a date')).toBe('');
  });
});
