import { unstable_cache, revalidateTag } from 'next/cache';

// Cache tags — the single source of truth shared by the cached READ routes (which
// tag their entries) and the WRITE routes (which bust them). Keep these in lockstep.
export const CACHE_TAGS = {
  cardsCatalog: 'cards-catalog',
  teamOverview: 'team-overview',
  stats: 'stats',
  publicReplays: 'public-replays',
} as const;

// Which cached surfaces each replay mutation can stale. Sharing/unsharing changes
// what surfaces to a team (overview) AND which games feed team stats; publish
// toggles the public browser; delete can touch all three; review flags ride the
// team dashboard. (Labels/titles only appear on UNCACHED grids → no tag.)
const OP_TAGS: Record<string, string[]> = {
  share: [CACHE_TAGS.teamOverview, CACHE_TAGS.stats],
  unshare: [CACHE_TAGS.teamOverview, CACHE_TAGS.stats],
  publish: [CACHE_TAGS.publicReplays],
  unpublish: [CACHE_TAGS.publicReplays],
  delete: [CACHE_TAGS.teamOverview, CACHE_TAGS.stats, CACHE_TAGS.publicReplays],
  'review-request': [CACHE_TAGS.teamOverview],
  'review-cancel': [CACHE_TAGS.teamOverview],
};

// Bust the caches a set of mutations can stale, so a share/publish/delete shows
// up on the NEXT read (Next marks the tag stale-while-revalidate: the next request
// serves stale + recomputes, the one after is fresh) instead of waiting out the
// 45–120s read TTL. Tags are coarse (one per surface, not per-team) —
// over-invalidating slightly is fine at this scale.
// Best-effort: revalidateTag throws outside a request scope (unit tests call the
// handlers directly) — swallow only that so a mutation never fails on cache bust.
export function revalidateForOps(ops: string[]): void {
  const tags = new Set<string>();
  for (const op of ops) for (const t of OP_TAGS[op] ?? []) tags.add(t);
  // Next 16: revalidateTag(tag) is deprecated; pass the 'max' profile for the
  // old "purge now" behavior (updateTag is Server-Action-only, throws in routes).
  for (const t of tags) {
    try { revalidateTag(t, 'max'); } catch { /* no request scope (tests) — read TTL still covers it */ }
  }
}

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
