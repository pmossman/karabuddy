// B234 (storage cost): replay payload retention.
//
// A replay's payload blob (the multi-hundred-kB event stream) is only needed to
// WATCH the replay. Every derived fact — matches, match_players, card_events,
// openings, sideboards, tags — is materialized at upload (ADR 0007), so deleting
// the blob loses nothing for stats, leaderboards or the replay list; only the
// viewer's board playback. Measured 2026-09-08: 94% of replays (43 GB of 48)
// had never been opened once.
//
// Rule: delete the blob of any replay that is older than the retention window
// AND has never been viewed, unless it's pinned by something that needs the
// frames: made public, clipped, or sent for a review. "Viewed" = a row in
// replay_views (signed-in viewers) OR replays.last_viewed_at (stamped for every
// viewer, signed-in or not — app/api/replays/[slug]/viewed). Inline `data:`
// payloads (local/demo seeds) are never touched.
//
// Pruned rows keep their URL for audit and get `payload_pruned_at`; the viewer
// shows an "expired" notice. A later snapshot upload for the same game re-writes
// the blob and clears the mark (app/api/replays/route.ts).
//
// Driven by the daily Vercel cron (app/api/cron/prune-payloads, vercel.json) and
// by scripts/prune-payloads.ts for the initial backlog.

import { and, asc, isNull, lt, notLike, notExists, sql, inArray } from 'drizzle-orm';
import { getDb } from './db';
import { deletePayloadBlobs } from './blob';
import { clips, replayReviews, replayViews, replays } from './schema';

export const DEFAULT_RETENTION_DAYS = 30;

// B236: opt-in blanket row retention. When REPLAY_ROW_RETENTION_DAYS is set,
// replay ROWS older than that are deleted outright (the FKs cascade: matches →
// card facts, tags, participants, openings, sideboards, views, shares). Public
// replays and clipped replays are exempt. Unset = off.
export function rowRetentionDays(): number | null {
  const n = Number(process.env.REPLAY_ROW_RETENTION_DAYS);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface DeleteRowsResult { days: number; cutoff: string; deleted: number; more: boolean; dryRun: boolean }

export async function deleteExpiredReplayRows(opts: { days: number; batch?: number; limit?: number; timeBudgetMs?: number; dryRun?: boolean; now?: Date; log?: (m: string) => void }): Promise<DeleteRowsResult> {
  const batch = Math.max(1, opts.batch ?? 500);
  const limit = opts.limit ?? Infinity;
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - opts.days * 86_400_000);
  const started = Date.now();
  const db = getDb();
  const r = replays;
  const cond = and(
    lt(r.createdAt, cutoff),
    isNull(r.publicAt),
    notExists(db.select({ x: sql`1` }).from(clips).where(sql`${clips.replaySlug} = ${r.slug}`)),
  );
  const result: DeleteRowsResult = { days: opts.days, cutoff: cutoff.toISOString(), deleted: 0, more: false, dryRun: !!opts.dryRun };
  if (opts.dryRun) {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(r).where(cond);
    result.deleted = Math.min(Number(row?.n ?? 0), limit);
    result.more = Number(row?.n ?? 0) > result.deleted;
    return result;
  }
  while (result.deleted < limit) {
    if (opts.timeBudgetMs != null && Date.now() - started > opts.timeBudgetMs) { result.more = true; break; }
    const want = Math.min(batch, limit - result.deleted);
    const victims = await db.select({ slug: r.slug }).from(r).where(cond).orderBy(asc(r.createdAt)).limit(want);
    if (victims.length === 0) break;
    await db.delete(r).where(inArray(r.slug, victims.map((v) => v.slug)));
    result.deleted += victims.length;
    opts.log?.(`[retention] ${result.deleted} replay rows deleted so far`);
    if (victims.length < want) break;
  }
  if (result.deleted >= limit && limit !== Infinity) result.more = true;
  return result;
}
export const DEFAULT_PRUNE_BATCH = 200;

export function retentionDays(): number {
  const n = Number(process.env.REPLAY_PAYLOAD_RETENTION_DAYS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RETENTION_DAYS;
}

export interface PrunableReplay {
  slug: string;
  payloadBlobUrl: string;
  payloadSizeBytes: number;
}

export interface PruneOptions {
  days?: number;
  // Rows per delete batch (one blob-store call + one UPDATE each).
  batch?: number;
  // Stop after this many rows (default: unbounded).
  limit?: number;
  // Stop starting new batches after this many ms (the cron's function budget).
  timeBudgetMs?: number;
  dryRun?: boolean;
  now?: Date;
  log?: (msg: string) => void;
}

export interface PruneResult {
  days: number;
  cutoff: string;
  candidates: number;
  pruned: number;
  // Sum of payload_size_bytes (raw JSON size) of pruned rows — an upper bound
  // on the storage freed (stored bytes are gzip'd, ~24x smaller).
  rawBytes: number;
  failedBatches: number;
  dryRun: boolean;
  // True when the run stopped on limit/time budget with candidates remaining.
  more: boolean;
}

export async function findPrunableReplays(opts: { cutoff: Date; limit: number }): Promise<PrunableReplay[]> {
  const db = getDb();
  const r = replays;
  return db
    .select({ slug: r.slug, payloadBlobUrl: r.payloadBlobUrl, payloadSizeBytes: r.payloadSizeBytes })
    .from(r)
    .where(
      and(
        isNull(r.payloadPrunedAt),
        lt(r.createdAt, opts.cutoff),
        isNull(r.publicAt),
        isNull(r.lastViewedAt),
        notLike(r.payloadBlobUrl, 'data:%'),
        notExists(db.select({ x: sql`1` }).from(replayViews).where(sql`${replayViews.replaySlug} = ${r.slug}`)),
        notExists(db.select({ x: sql`1` }).from(clips).where(sql`${clips.replaySlug} = ${r.slug}`)),
        notExists(db.select({ x: sql`1` }).from(replayReviews).where(sql`${replayReviews.replaySlug} = ${r.slug}`)),
      ),
    )
    .orderBy(asc(r.createdAt))
    .limit(opts.limit);
}

// Count (and size) everything the rule would prune right now — one query, used
// by dry runs. (A dry run can't page through candidates by re-selecting: nothing
// gets marked, so the same batch would come back forever.)
export async function countPrunableReplays(cutoff: Date): Promise<{ count: number; rawBytes: number }> {
  const db = getDb();
  const r = replays;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int`, rawBytes: sql<number>`coalesce(sum(${r.payloadSizeBytes}), 0)::bigint` })
    .from(r)
    .where(
      and(
        isNull(r.payloadPrunedAt),
        lt(r.createdAt, cutoff),
        isNull(r.publicAt),
        isNull(r.lastViewedAt),
        notLike(r.payloadBlobUrl, 'data:%'),
        notExists(db.select({ x: sql`1` }).from(replayViews).where(sql`${replayViews.replaySlug} = ${r.slug}`)),
        notExists(db.select({ x: sql`1` }).from(clips).where(sql`${clips.replaySlug} = ${r.slug}`)),
        notExists(db.select({ x: sql`1` }).from(replayReviews).where(sql`${replayReviews.replaySlug} = ${r.slug}`)),
      ),
    );
  return { count: Number(row?.count ?? 0), rawBytes: Number(row?.rawBytes ?? 0) };
}

export async function pruneReplayPayloads(opts: PruneOptions = {}): Promise<PruneResult> {
  const days = opts.days ?? retentionDays();
  const batch = Math.max(1, opts.batch ?? DEFAULT_PRUNE_BATCH);
  const limit = opts.limit ?? Infinity;
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const started = Date.now();
  const log = opts.log ?? (() => {});
  const db = getDb();

  const result: PruneResult = {
    days, cutoff: cutoff.toISOString(), candidates: 0, pruned: 0, rawBytes: 0, failedBatches: 0, dryRun: !!opts.dryRun, more: false,
  };

  if (opts.dryRun) {
    const c = await countPrunableReplays(cutoff);
    const n = Math.min(c.count, limit);
    return { ...result, candidates: c.count, pruned: n, rawBytes: n === c.count ? c.rawBytes : Math.round((c.rawBytes * n) / Math.max(1, c.count)), more: n < c.count };
  }

  // Rows that fail to delete would be re-selected forever; remember them for
  // this run so a persistent store error can't spin the loop.
  const skip = new Set<string>();

  while (result.pruned + skip.size < limit) {
    if (opts.timeBudgetMs != null && Date.now() - started > opts.timeBudgetMs) { result.more = true; break; }
    const want = Math.min(batch, limit - result.pruned - skip.size);
    const rows = (await findPrunableReplays({ cutoff, limit: want + skip.size })).filter((r) => !skip.has(r.slug)).slice(0, want);
    if (rows.length === 0) break;
    result.candidates += rows.length;
    try {
      await deletePayloadBlobs(rows.map((r) => r.payloadBlobUrl));
    } catch (e) {
      result.failedBatches += 1;
      for (const r of rows) skip.add(r.slug);
      log(`[prune] blob delete failed for batch of ${rows.length}: ${(e as Error).message}`);
      if (result.failedBatches >= 3) { result.more = true; break; }
      continue;
    }
    await db
      .update(replays)
      .set({ payloadPrunedAt: now })
      .where(inArray(replays.slug, rows.map((r) => r.slug)));
    result.pruned += rows.length;
    result.rawBytes += rows.reduce((a, r) => a + (r.payloadSizeBytes || 0), 0);
    log(`[prune] ${result.pruned} pruned so far (${(result.rawBytes / 1048576).toFixed(0)} MB raw)`);
    if (rows.length < want) break;
  }
  if (result.pruned + skip.size >= limit && limit !== Infinity) result.more = true;
  return result;
}
