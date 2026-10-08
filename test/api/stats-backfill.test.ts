import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { replays, matches, matchPlayers } from '@/lib/schema';
import { putPayload } from '@/lib/blob';
import { backfillStats, parseSlugList } from '@/lib/statsBackfill';

// scripts/backfill-stats.ts core: the repair re-persists an explicit slug list
// (`--slugs-file`) in one process, reports progress + ok/failed, and hands back
// the failed slugs for a re-run.

const noSleep = () => Promise.resolve();

// A raw karabast-shaped payload (what the extension uploads): one full gamestate
// where the recorder's opening hand is visible, so the recorder's seat gets
// first-person card facts.
function rawPayload(gameId: string, recorder: 'p1' | 'p2') {
  const card = (n: number, uuid: string) => ({ uuid, setId: { set: 'SOR', number: n }, id: `SOR_${String(n).padStart(3, '0')}` });
  const side = (name: string, leader: number, base: number, hand: any[]) => ({
    user: { username: name },
    leader: { name: 'L', setId: { set: 'SOR', number: leader } },
    base: { name: 'B', setId: { set: 'SOR', number: base } },
    cardPiles: { hand, deck: [], resources: [], groundArena: [], spaceArena: [], discard: [] },
  });
  return {
    version: 2, actionCount: 10, durationMs: 1000, localPlayerId: recorder,
    events: [{ event: 'gamestate', args: [{ full: { id: gameId, players: {
      p1: side('Alice', 1, 20, recorder === 'p1' ? [card(101, 'a')] : []),
      p2: side('Bob', 5, 21, recorder === 'p2' ? [card(150, 'b')] : []),
    } } }] }],
    tags: [],
  };
}

async function seedReplay(gameId: string, seat: 'p1' | 'p2', o: { payload?: unknown; pruned?: boolean; winners?: string[] } = {}) {
  const slug = `r_${gameId}_${seat}`;
  const { url } = await putPayload(`replays/${slug}.json`, JSON.stringify(o.payload ?? rawPayload(gameId, seat)));
  await getDb().insert(replays).values({
    slug, gameId, ownerToken: 'kbx_' + randomUUID(), ownerPlayerId: seat, players: [], payloadBlobUrl: url, durationMs: 1,
    winners: o.winners ?? ['p1'], payloadPrunedAt: o.pruned ? new Date() : null,
  });
  return slug;
}

describe('parseSlugList', () => {
  it('one slug per line; blanks, # comments and duplicates dropped', () => {
    expect(parseSlugList('a\n\n  b  \n# note\nc # trailing\na\r\nd')).toEqual(['a', 'b', 'c', 'd']);
    expect(parseSlugList('')).toEqual([]);
  });
});

describe('backfillStats — listed slugs', () => {
  it('re-persists exactly the listed replays and reports ok / skipped / failed / missing', async () => {
    const ok1 = await seedReplay('g1', 'p1');
    const ok2 = await seedReplay('g2', 'p2');
    const pruned = await seedReplay('g3', 'p1', { pruned: true });
    const broken = await seedReplay('g4', 'p1', { payload: { version: 9 } }); // undecodable
    const untouched = await seedReplay('g5', 'p1'); // not listed
    const lines: string[] = [];
    const s = await backfillStats({ slugs: [ok1, ok2, pruned, broken, 'nope', ok1], concurrency: 3, progressEvery: 2, log: (l) => lines.push(l), sleep: noSleep });

    expect(s).toMatchObject({ selected: 4, ok: 2, skipped: 1, failed: 1, failedSlugs: [broken], missing: ['nope'] });
    expect(Object.keys(s.failReasons)).toEqual(['Unsupported replay version: 9']);
    expect(lines.some((l) => l.includes('4/4'))).toBe(true); // a final progress line
    const games = (await getDb().select({ g: matches.gameId }).from(matches)).map((r) => r.g).sort();
    expect(games).toEqual(['g1', 'g2']); // nothing for the pruned, broken or unlisted ones
    expect(untouched).toBeTruthy();
  });

  it('dry run resolves the selection and writes nothing', async () => {
    const a = await seedReplay('d1', 'p1');
    const b = await seedReplay('d2', 'p1', { pruned: true });
    const s = await backfillStats({ slugs: [a, b, 'missing-one'], dryRun: true });
    expect(s).toMatchObject({ selected: 2, wouldSkipPruned: 1, missing: ['missing-one'], ok: 0, failed: 0 });
    expect(await getDb().select().from(matches)).toHaveLength(0);
  });

  it('the repair: re-persisting the seat the old design left unflagged restores its flag + facts and keeps the rest', async () => {
    // A co-recorded game as the pre-B237 design stored it: p1's upload persisted
    // last, so only p1 is a recorded seat, and p2's first-person facts are gone.
    const s1 = await seedReplay('rep', 'p1');
    const s2 = await seedReplay('rep', 'p2');
    await backfillStats({ slugs: [s1], sleep: noSleep });
    const playedAt = new Date('2026-07-04T20:00:00Z');
    await getDb().update(matches).set({ createdAt: playedAt }).where(eq(matches.gameId, 'rep'));
    const seat = async (pid: string) => (await getDb().select().from(matchPlayers).where(and(eq(matchPlayers.gameId, 'rep'), eq(matchPlayers.playerId, pid))))[0];
    expect(await seat('p2')).toMatchObject({ isRecorder: false, cardEvents: null });

    const s = await backfillStats({ slugs: [s2], sleep: noSleep });
    expect(s).toMatchObject({ ok: 1, failed: 0 });
    expect(await seat('p2')).toMatchObject({ isRecorder: true, cardEvents: { drawn: { SOR_150: expect.any(Number) } } });
    expect(await seat('p1')).toMatchObject({ isRecorder: true, cardEvents: { drawn: { SOR_101: expect.any(Number) } } });
    const [m] = await getDb().select().from(matches).where(eq(matches.gameId, 'rep'));
    expect(m.createdAt.toISOString()).toBe(playedAt.toISOString());
    expect(m.replaySlug).toBe(s2);
  });
});

describe('backfillStats — full scan (no list)', () => {
  it('skips games that already have facts unless forced', async () => {
    const a = await seedReplay('f1', 'p1');
    await seedReplay('f2', 'p1');
    await backfillStats({ slugs: [a], sleep: noSleep });
    expect((await backfillStats({ sleep: noSleep })).selected).toBe(1); // only f2
    expect((await backfillStats({ force: true, dryRun: true })).selected).toBe(2);
  });
});
