// Core of scripts/backfill-leaders.ts. Only null leader fields are written, and
// only when `write` is set.

import { and, asc, eq, gt, gte, isNull, sql } from 'drizzle-orm';
import { getDb } from './db';
import { matchPlayers, replays } from './schema';
import { readBlobText } from './blob';
import { decodeReplay, firstSnapshot, summarizePlayers, type ReplayPlayerSummary } from './replayDecoder';
import { extractReplayFacts } from './statsExtract';

export const LEADERS_BROKE_AT = new Date('2026-09-29T00:00:00Z');

export interface LeaderBackfillOptions {
  write: boolean;
  since?: Date;
  limit?: number;
  batchSize?: number;
  slug?: string;
  log?: (line: string) => void;
}

export interface LeaderBackfillSummary {
  found: number;
  fixed: number;
  partial: number;
  unresolvable: number;
  reasons: Record<string, number>;
}

type Row = Pick<typeof replays.$inferSelect, 'slug' | 'gameId' | 'players' | 'payloadBlobUrl' | 'payloadPrunedAt' | 'winners' | 'ownerPlayerId' | 'durationMs'>;
type RowOutcome = { status: 'fixed' | 'partial' | 'unresolvable' | 'ok'; changes: string[]; reason?: string };

const hasLeader = (p: any) => p?.leader != null && typeof p.leader === 'object';

const missingLeaderSql = sql`(
  EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${replays.players}) = 'array' THEN ${replays.players} ELSE '[]'::jsonb END) AS e
          WHERE jsonb_typeof(e->'leader') IS DISTINCT FROM 'object')
  OR EXISTS (SELECT 1 FROM ${matchPlayers} mp
             WHERE mp.game_id = ${replays.gameId} AND (mp.leader IS NULL OR mp.opponent_leader IS NULL))
)`;

export async function backfillLeaders(opts: LeaderBackfillOptions): Promise<LeaderBackfillSummary> {
  const db = getDb();
  const log = opts.log ?? (() => {});
  const since = opts.since ?? LEADERS_BROKE_AT;
  const batchSize = Math.max(1, opts.batchSize ?? 50);
  const limit = opts.limit ?? Infinity;
  const summary: LeaderBackfillSummary = { found: 0, fixed: 0, partial: 0, unresolvable: 0, reasons: {} };

  let after = '';
  while (summary.found < limit) {
    const page: Row[] = await db
      .select({
        slug: replays.slug,
        gameId: replays.gameId,
        players: replays.players,
        payloadBlobUrl: replays.payloadBlobUrl,
        payloadPrunedAt: replays.payloadPrunedAt,
        winners: replays.winners,
        ownerPlayerId: replays.ownerPlayerId,
        durationMs: replays.durationMs,
      })
      .from(replays)
      .where(and(
        eq(replays.encrypted, false),
        gte(replays.createdAt, since),
        gt(replays.slug, after),
        opts.slug ? eq(replays.slug, opts.slug) : undefined,
        missingLeaderSql,
      ))
      .orderBy(asc(replays.slug))
      .limit(Math.min(batchSize, limit - summary.found));
    if (page.length === 0) break;
    after = page[page.length - 1].slug;

    for (const row of page) {
      summary.found++;
      const outcome = await backfillRow(row, opts.write);
      if (outcome.status !== 'ok') summary[outcome.status]++;
      if (outcome.reason) summary.reasons[outcome.reason] = (summary.reasons[outcome.reason] ?? 0) + 1;
      const detail = outcome.changes.length ? outcome.changes.join('; ') : '';
      log(`  ${row.slug}: ${outcome.status}${outcome.reason ? ` (${outcome.reason})` : ''}${detail ? ` — ${detail}` : ''}`);
    }
  }
  return summary;
}

async function backfillRow(row: Row, write: boolean): Promise<RowOutcome> {
  if (row.payloadPrunedAt) return { status: 'unresolvable', changes: [], reason: 'payload pruned' };
  const text = await readBlobText(row.payloadBlobUrl);
  if (text === null) return { status: 'unresolvable', changes: [], reason: 'blob fetch failed' };
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { return { status: 'unresolvable', changes: [], reason: 'invalid JSON' }; }

  const db = getDb();
  const changes: string[] = [];
  let stillMissing = false;

  const derived = new Map(summarizePlayers(firstSnapshot(parsed)?.players).map((p) => [p.id, p]));
  const current = Array.isArray(row.players) ? (row.players as any[]) : [];
  let playersChanged = false;
  const merged = current.map((p) => {
    if (hasLeader(p)) return p;
    const d: ReplayPlayerSummary | undefined = p?.id ? derived.get(p.id) : undefined;
    if (!d?.leader) { stillMissing = true; return p; }
    playersChanged = true;
    changes.push(`players[${p.id}].leader → ${d.leader.name} (${d.leader.set}_${String(d.leader.number).padStart(3, '0')})${d.secondLeader ? ` + ${d.secondLeader.name}` : ''}`);
    return { ...p, leader: d.leader, ...(d.secondLeader ? { secondLeader: d.secondLeader } : {}) };
  });
  if (playersChanged && write) {
    await db.update(replays).set({ players: merged }).where(eq(replays.slug, row.slug));
  }

  const mpRows = await db
    .select({ playerId: matchPlayers.playerId, leader: matchPlayers.leader, opponentLeader: matchPlayers.opponentLeader })
    .from(matchPlayers)
    .where(eq(matchPlayers.gameId, row.gameId));
  if (mpRows.some((r) => r.leader == null || r.opponentLeader == null)) {
    let facts: ReturnType<typeof extractReplayFacts>['matchFact'] = null;
    try {
      facts = extractReplayFacts(decodeReplay(parsed), {
        gameId: row.gameId,
        winners: (row.winners as string[] | null) ?? null,
        ownerPlayerId: row.ownerPlayerId ?? null,
        durationMs: row.durationMs ?? null,
      }).matchFact;
    } catch {
      facts = null;
    }
    const fact = new Map((facts?.players ?? []).map((p) => [p.playerId, p]));
    const opponentOf = (pid: string) => (fact.size === 2 ? [...fact.values()].find((p) => p.playerId !== pid) ?? null : null);
    for (const mp of mpRows) {
      const own = fact.get(mp.playerId);
      if (mp.leader == null) {
        if (own?.leader) {
          changes.push(`match_players[${mp.playerId}].leader → ${own.leader}`);
          if (write) {
            await db.update(matchPlayers)
              .set({ leader: own.leader, aspects: own.aspects })
              .where(and(eq(matchPlayers.gameId, row.gameId), eq(matchPlayers.playerId, mp.playerId), isNull(matchPlayers.leader)));
          }
        } else stillMissing = true;
      }
      if (mp.opponentLeader == null) {
        const opp = opponentOf(mp.playerId);
        if (opp?.leader) {
          changes.push(`match_players[${mp.playerId}].opponent_leader → ${opp.leader}`);
          if (write) {
            await db.update(matchPlayers)
              .set({ opponentLeader: opp.leader })
              .where(and(eq(matchPlayers.gameId, row.gameId), eq(matchPlayers.playerId, mp.playerId), isNull(matchPlayers.opponentLeader)));
          }
        } else stillMissing = true;
      }
    }
  }

  if (changes.length === 0) {
    return stillMissing ? { status: 'unresolvable', changes, reason: 'no leaders in payload' } : { status: 'ok', changes };
  }
  return { status: stillMissing ? 'partial' : 'fixed', changes };
}
