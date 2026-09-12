import { NextResponse } from 'next/server';
import { pruneReplayPayloads, retentionDays } from '@/lib/replayRetention';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Well under the Hobby-plan function ceiling (300 s); the loop stops starting
// new batches at TIME_BUDGET_MS and reports `more: true` so the next day picks up.
export const maxDuration = 120;
const TIME_BUDGET_MS = 90_000;

// GET /api/cron/prune-payloads — B234: daily payload retention (vercel.json
// `crons`). Vercel invokes it with `Authorization: Bearer $CRON_SECRET`; anything
// else is rejected. Steady state is ~1–2k rows/day, one run.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const dryRun = new URL(req.url).searchParams.get('dry') === '1';
  const result = await pruneReplayPayloads({ days: retentionDays(), timeBudgetMs: TIME_BUDGET_MS, dryRun, log: (m) => console.log(m) });
  console.log('[prune-payloads]', JSON.stringify(result));
  return NextResponse.json({ ok: true, ...result });
}
