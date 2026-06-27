import { unstable_cache } from 'next/cache';

// Perf: wrap a PURE data function in Next's Data Cache (cross-instance, TTL'd) to
// cut repeated DB work — the dominant Neon compute driver was read-heavy routes
// recomputing from scratch on every request (no caching anywhere + force-dynamic).
//
// `unstable_cache` requires Next's incremental cache, which is present in prod
// route handlers but ABSENT in unit tests / any non-request context (it throws
// "Invariant: incrementalCache missing"). So we fall back to calling the function
// directly there — correct, just uncached. Real errors still propagate.
//
// Call args are folded into the cache key automatically (alongside `keyParts`), so
// a per-team / per-scope function caches correctly by its arguments. Only cache
// data that is the SAME for every caller of a given key (team/catalog/public
// data) — never per-user data under a shared key.
export function cachedRead<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  keyParts: string[],
  opts: { revalidate: number; tags?: string[] },
): (...args: A) => Promise<R> {
  const wrapped = unstable_cache(fn, keyParts, opts) as (...args: A) => Promise<R>;
  return async (...args: A) => {
    try {
      return await wrapped(...args);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('incrementalCache missing')) return fn(...args);
      throw e;
    }
  };
}
