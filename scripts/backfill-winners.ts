// One-shot backfill: re-extract `winners`, `ownerPlayerId`, and the
// per-player `id` for replays uploaded before B59's patch-aware
// reconstruction landed (or before the upload route stored player ids).
//
// Idempotent — only updates rows where the targeted field is missing
// AND the payload actually carries the data. Safe to re-run.
//
// Run: tsx scripts/backfill-winners.ts [slug]
//   - With a slug: backfill only that one row.
//   - Without:    walk every replay.

import { eq, isNull } from 'drizzle-orm';
import { getDb } from '../lib/db';
import { replays } from '../lib/schema';
import { extractWinners, reconstructFinalState } from '../lib/replayDecoder';

async function backfillOne(row: typeof replays.$inferSelect, force = false): Promise<{
  slug: string;
  updates: Record<string, unknown>;
  reason?: string;
}> {
  const payloadRes = await fetch(row.payloadBlobUrl);
  if (!payloadRes.ok) {
    return { slug: row.slug, updates: {}, reason: `blob fetch ${payloadRes.status}` };
  }
  const text = await payloadRes.text();
  let parsed: any;
  try { parsed = JSON.parse(text); } catch {
    return { slug: row.slug, updates: {}, reason: 'invalid JSON' };
  }

  const updates: Record<string, unknown> = {};

  // winners: reconstruct final state, extract. With --force, re-run
  // even when the row already has a winners value (catches earlier
  // backfills that stored the raw username instead of the resolved
  // playerId).
  if (force || row.winners == null) {
    const finalSnapshot = reconstructFinalState(parsed);
    const winners = extractWinners(finalSnapshot);
    if (winners) updates.winners = winners;
  }

  // ownerPlayerId: lift from payload.
  if ((force || !row.ownerPlayerId) && typeof parsed.localPlayerId === 'string') {
    updates.ownerPlayerId = parsed.localPlayerId;
  }

  // players[].id: re-serialize from the FIRST gamestate's players map
  // to include the playerID (pre-B59 row serializer dropped it).
  const players = Array.isArray(row.players) ? (row.players as any[]) : [];
  const anyMissingId = players.some((p) => !p?.id);
  if (force || anyMissingId) {
    const firstGs = (parsed.events as any[] | undefined)?.find(
      (e: any) => e.event === 'gamestate' && e.args?.[0]?.full,
    );
    const snapshot = firstGs?.args?.[0]?.full;
    if (snapshot?.players && typeof snapshot.players === 'object') {
      const reserialized = Object.entries(snapshot.players as Record<string, any>).map(
        ([id, p]: [string, any]) => ({
          id,
          username: p.user?.username || '',
          leader: p.leader
            ? { name: p.leader.name || '', set: p.leader.setId?.set || '', number: p.leader.setId?.number || 0 }
            : null,
          base: p.base
            ? { name: p.base.name || '', set: p.base.setId?.set || '', number: p.base.setId?.number || 0 }
            : null,
        })
      );
      if (reserialized.length > 0) updates.players = reserialized;
    }
  }

  if (Object.keys(updates).length === 0) {
    return { slug: row.slug, updates, reason: 'nothing to backfill' };
  }
  const db = getDb();
  await db.update(replays).set(updates).where(eq(replays.slug, row.slug));
  return { slug: row.slug, updates };
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const slugArg = args.find((a) => !a.startsWith('--'));
  const db = getDb();
  const rows = slugArg
    ? await db.select().from(replays).where(eq(replays.slug, slugArg))
    : force
    ? await db.select().from(replays)
    : await db.select().from(replays).where(isNull(replays.winners));
  console.log(`scanning ${rows.length} row(s)${force ? ' (force)' : ''}`);
  for (const row of rows) {
    const result = await backfillOne(row, force);
    const fields = Object.keys(result.updates);
    if (fields.length > 0) {
      console.log(`  ${row.slug}: updated ${fields.join(', ')}`);
    } else {
      console.log(`  ${row.slug}: skip (${result.reason || 'no change'})`);
    }
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
