import { describe, it, expect, vi, beforeEach } from 'vitest';

// persistReplayStats (upload + manual-result path) retries a TRANSIENT failure of
// the idempotent stats write — a deadlock or a CockroachDB 40001 — instead of
// swallowing it and losing the game's facts; real errors are not retried.
vi.mock('@/lib/statsPersist', () => ({ persistReplayFacts: vi.fn() }));
const { persistReplayFacts } = await import('@/lib/statsPersist');
const { persistReplayStats } = await import('@/lib/replayStatsPersist');
const persist = vi.mocked(persistReplayFacts);

const payload = {
  version: 2, actionCount: 1, durationMs: 1, localPlayerId: 'p1',
  events: [{ event: 'gamestate', args: [{ full: { id: 'g-retry', players: { p1: { user: { username: 'A' } }, p2: { user: { username: 'B' } } } } }] }],
  tags: [],
};
const sqlError = (code: string) => Object.assign(new Error(`sqlstate ${code}`), { code });

beforeEach(() => {
  persist.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('persistReplayStats — transient DB errors', () => {
  it('retries a serialization failure and lands the write', async () => {
    persist.mockRejectedValueOnce(new Error('Failed query', { cause: sqlError('40001') })).mockResolvedValueOnce({ matchWritten: true, cardEvents: 0 });
    await persistReplayStats('r_retry', payload, 'g-retry', ['p1']);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(console.error).not.toHaveBeenCalledWith('[stats] persistReplayFacts failed for', 'r_retry', expect.anything());
  });

  it('does not retry a real error (logged and swallowed, as before)', async () => {
    persist.mockRejectedValue(sqlError('23503'));
    await persistReplayStats('r_real', payload, 'g-retry', ['p1']);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith('[stats] persistReplayFacts failed for', 'r_real', expect.anything());
  });
});
