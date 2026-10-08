// Core of scripts/backfill-stats.ts: re-materialize Stats/Meta facts from stored
// replay payloads through the same persistReplayFacts the upload path uses.
// Writes are upserts (idempotent; matches.created_at kept), so re-running any
// slug is safe.
//
// Two selections:
//   - `slugs`: exactly these replays, always re-persisted (the repair / re-run
//     mode — a slug listed twice is processed once; unknown slugs are reported
//     as `missing`, not failed);
//   - otherwise every replay, skipping games that already have facts unless
//     `force`, then `offset` / `limit`.

import { inArray } from 'drizzle-orm';
import { getDb } from './db';
import { replays, matches } from './schema';
import { decodeReplay } from './replayDecoder';
import { persistReplayFacts } from './statsPersist';
import { readBlobJson } from './blob';

type Row = typeof replays.$inferSelect;

export interface StatsBackfillOptions {
  slugs?: string[];
  force?: boolean;
  offset?: number;
  limit?: number;
  concurrency?: number; // replays processed in parallel (default 1)
  attempts?: number; // tries per replay's DB write (default 8)
  dryRun?: boolean; // resolve the selection and report it; write nothing
  progressEvery?: number; // log a progress line every N replays (default 500)
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>; // retry backoff (injectable for tests)
}

export interface StatsBackfillSummary {
  selected: number; // replays found for the selection
  ok: number; // facts written
  skipped: number; // payload pruned/unreadable, or nothing to record
  failed: number;
  failedSlugs: string[]; // for a re-run (--slugs-file=<failed file>)
  missing: string[]; // listed slugs with no replay row
  failReasons: Record<string, number>;
  wouldSkipPruned: number; // dry run: selected rows whose payload is already pruned
}

// Turn a slugs file's text into a list: one slug per line; blank lines and
// `#` comments ignored; duplicates dropped (first occurrence kept).
export function parseSlugList(text: string): string[] {
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const s = line.replace(/#.*/, '').trim();
    if (s) seen.add(s);
  }
  return [...seen];
}

async function selectRows(opts: StatsBackfillOptions): Promise<{ rows: Row[]; missing: string[] }> {
  const db = getDb();
  if (opts.slugs) {
    const slugs = [...new Set(opts.slugs)];
    const bySlug = new Map<string, Row>();
    for (let i = 0; i < slugs.length; i += 500) {
      const chunk = slugs.slice(i, i + 500);
      for (const r of await db.select().from(replays).where(inArray(replays.slug, chunk))) bySlug.set(r.slug, r);
    }
    const rows = slugs.map((s) => bySlug.get(s)).filter((r): r is Row => !!r);
    return { rows, missing: slugs.filter((s) => !bySlug.has(s)) };
  }
  let rows = await db.select().from(replays);
  if (!opts.force) {
    const done = new Set((await db.select({ gameId: matches.gameId }).from(matches)).map((r) => r.gameId));
    rows = rows.filter((r) => !done.has(r.gameId));
  }
  if (opts.offset) rows = rows.slice(opts.offset);
  if (opts.limit != null && Number.isFinite(opts.limit)) rows = rows.slice(0, opts.limit);
  return { rows, missing: [] };
}

export async function backfillStats(opts: StatsBackfillOptions = {}): Promise<StatsBackfillSummary> {
  const log = opts.log ?? (() => {});
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const attempts = Math.max(1, opts.attempts ?? 8);
  const concurrency = Math.max(1, opts.concurrency ?? 1);
  const progressEvery = Math.max(1, opts.progressEvery ?? 500);
  const { rows, missing } = await selectRows(opts);
  const summary: StatsBackfillSummary = {
    selected: rows.length, ok: 0, skipped: 0, failed: 0, failedSlugs: [], missing, failReasons: {}, wouldSkipPruned: 0,
  };
  if (missing.length) log(`${missing.length} listed slug(s) have no replay row: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ', …' : ''}`);
  if (opts.dryRun) {
    summary.wouldSkipPruned = rows.filter((r) => r.payloadPrunedAt).length;
    return summary;
  }

  let done = 0;
  const started = Date.now();
  const processOne = async (row: Row) => {
    try {
      const payload = row.payloadPrunedAt ? null : await readBlobJson(row.payloadBlobUrl);
      if (!payload) { summary.skipped++; return; }
      const decoded = decodeReplay(payload);
      // Retry with backoff: Neon HTTP has no interactive transactions, so a write
      // that hits a transient error (deadlock on the shared cards catalog, a
      // dropped connection) just runs again — every step is an upsert.
      let r;
      for (let attempt = 1; ; attempt++) {
        try {
          r = await persistReplayFacts({
            decoded,
            replaySlug: row.slug,
            gameId: row.gameId,
            winners: (row.winners as string[] | null) ?? null,
            ownerPlayerId: row.ownerPlayerId ?? null,
            durationMs: row.durationMs ?? null,
          });
          break;
        } catch (e) {
          if (attempt >= attempts) throw e;
          await sleep(attempt * 200 + Math.random() * 300);
        }
      }
      if (r.matchWritten) summary.ok++; else summary.skipped++;
    } catch (e: any) {
      summary.failed++;
      summary.failedSlugs.push(row.slug);
      // Bucket by reason (strip ids/params) so the tail shows a clean breakdown.
      const reason = String(e?.cause?.message ?? e?.message ?? e).replace(/[0-9a-f-]{20,}/g, '<id>').slice(0, 80);
      summary.failReasons[reason] = (summary.failReasons[reason] ?? 0) + 1;
    } finally {
      done++;
      if (done % progressEvery === 0 || done === rows.length) {
        const rate = done / Math.max(0.001, (Date.now() - started) / 1000);
        const eta = Math.round((rows.length - done) / rate / 60);
        log(`  ${done}/${rows.length} (${rate.toFixed(1)}/s, ~${eta}m left) — ok ${summary.ok}, skip ${summary.skipped}, fail ${summary.failed}`);
      }
    }
  };

  // Simple worker pool: `concurrency` workers pull from a shared cursor.
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
      while (cursor < rows.length) await processOne(rows[cursor++]);
    }),
  );
  return summary;
}
