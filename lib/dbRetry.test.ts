import { describe, it, expect, vi } from 'vitest';
import { isTransientDbError, withTransientDbRetry } from './dbRetry';

const pgError = (code: string, message = 'boom') => Object.assign(new Error(message), { code });
const noSleep = () => Promise.resolve();

describe('isTransientDbError', () => {
  it('recognizes deadlocks and serialization failures, by SQLSTATE or by message', () => {
    expect(isTransientDbError(pgError('40P01'))).toBe(true);
    expect(isTransientDbError(pgError('40001'))).toBe(true);
    expect(isTransientDbError(new Error('deadlock detected'))).toBe(true);
    expect(isTransientDbError(new Error('restart transaction: TransactionRetryWithProtoRefreshError'))).toBe(true); // CockroachDB
  });

  it('looks through a wrapping error (drizzle puts the driver error on .cause)', () => {
    expect(isTransientDbError(new Error('Failed query: insert into …', { cause: pgError('40001') }))).toBe(true);
  });

  it('does not retry real errors', () => {
    expect(isTransientDbError(pgError('23505', 'duplicate key value violates unique constraint "matches_pkey"'))).toBe(false);
    expect(isTransientDbError(pgError('23503'))).toBe(false);
    expect(isTransientDbError(new Error('connection refused'))).toBe(false);
    expect(isTransientDbError(null)).toBe(false);
    expect(isTransientDbError('40001')).toBe(false);
  });
});

describe('withTransientDbRetry', () => {
  it('retries a transient failure, then returns the result', async () => {
    const fn = vi.fn().mockRejectedValueOnce(pgError('40P01')).mockResolvedValueOnce('ok');
    const onRetry = vi.fn();
    await expect(withTransientDbRetry(fn, { sleep: noSleep, onRetry })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('gives up after the attempt budget and rethrows the last error', async () => {
    const fn = vi.fn().mockRejectedValue(pgError('40001'));
    await expect(withTransientDbRetry(fn, { attempts: 3, sleep: noSleep })).rejects.toMatchObject({ code: '40001' });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('rethrows a non-transient error at once', async () => {
    const fn = vi.fn().mockRejectedValue(pgError('23505'));
    await expect(withTransientDbRetry(fn, { sleep: noSleep })).rejects.toMatchObject({ code: '23505' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('backs off a little more on each attempt', async () => {
    const waits: number[] = [];
    const fn = vi.fn().mockRejectedValueOnce(pgError('40001')).mockRejectedValueOnce(pgError('40001')).mockResolvedValueOnce(1);
    await withTransientDbRetry(fn, { baseDelayMs: 100, sleep: async (ms) => { waits.push(ms); } });
    expect(waits).toHaveLength(2);
    expect(waits[0]).toBeGreaterThanOrEqual(100);
    expect(waits[0]).toBeLessThan(200);
    expect(waits[1]).toBeGreaterThanOrEqual(200);
    expect(waits[1]).toBeLessThan(300);
  });
});
