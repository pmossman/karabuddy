// Retry a database write on TRANSIENT errors only: a deadlock (Postgres 40P01)
// or a serialization failure (40001 — CockroachDB returns it as "restart
// transaction" under contention, and Postgres under SERIALIZABLE). Both mean
// "nothing was written, try again"; anything else is a real error and is
// rethrown at once. Only for idempotent writes (upserts, insert-or-ignore).
//
// Drivers surface the SQLSTATE differently (pg / pglite / Neon put it on
// `.code`; drizzle 0.45 wraps the driver error as `.cause`), so walk the chain.

const TRANSIENT_CODES = new Set(['40001', '40P01']);
const TRANSIENT_TEXT = /deadlock detected|could not serialize access|restart transaction/i;

export function isTransientDbError(e: unknown): boolean {
  let cur: any = e;
  for (let depth = 0; cur && depth < 5; depth++, cur = cur.cause) {
    if (typeof cur.code === 'string' && TRANSIENT_CODES.has(cur.code)) return true;
    if (TRANSIENT_TEXT.test(String(cur.message ?? ''))) return true;
  }
  return false;
}

export interface RetryOptions {
  attempts?: number; // total tries, including the first (default 3)
  baseDelayMs?: number; // backoff: attempt × base, plus up to `base` of jitter (default 100)
  sleep?: (ms: number) => Promise<void>; // injectable for tests
  onRetry?: (e: unknown, attempt: number) => void;
}

export async function withTransientDbRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseDelayMs ?? 100;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= attempts || !isTransientDbError(e)) throw e;
      opts.onRetry?.(e, attempt);
      await sleep(attempt * base + Math.random() * base);
    }
  }
}
