import { describe, expect, it, vi, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { POST as upload } from '@/app/api/replays/route';
import { getDb } from '@/lib/db';
import { matches, matchPlayers, replays } from '@/lib/schema';
import { putPayload } from '@/lib/blob';
import { backfillLeaders } from '@/lib/leaderBackfill';
import { leaderShapePayload } from '../fixtures/karabast-leader-shapes';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
beforeEach(() => vi.mocked(auth).mockResolvedValue(null as any));

const AFTER_BREAK = new Date('2026-09-30T12:00:00Z');
const BROKEN_PLAYERS = [
  { id: 'p1', username: 'Alice', leader: null, base: { name: 'Dagobah Swamp', set: 'SOR', number: 20 } },
  { id: 'p2', username: 'Bob', leader: null, base: { name: 'Command Center', set: 'SOR', number: 22 } },
];

async function seedBroken(slug: string, payload: any, over: { createdAt?: Date; payloadPrunedAt?: Date } = {}) {
  const gameId = `g-${slug}`;
  const { url } = await putPayload(`replays/${slug}.json`, JSON.stringify(payload));
  const db = getDb();
  await db.insert(replays).values({
    slug, gameId, ownerToken: 'kbx_seed', players: BROKEN_PLAYERS, payloadBlobUrl: url,
    winners: ['p1'], ownerPlayerId: 'p1', createdAt: over.createdAt ?? AFTER_BREAK, payloadPrunedAt: over.payloadPrunedAt ?? null,
  });
  await db.insert(matches).values({ gameId, replaySlug: slug, result: 'decisive' });
  await db.insert(matchPlayers).values([
    { gameId, playerId: 'p1', username: 'Alice', leader: null, base: 'SOR_020', aspects: ['vigilance'], isRecorder: true, won: true, opponentLeader: null, opponentBase: 'SOR_022' },
    { gameId, playerId: 'p2', username: 'Bob', leader: null, base: 'SOR_022', aspects: ['command'], isRecorder: false, won: false, opponentLeader: null, opponentBase: 'SOR_020' },
  ]);
  return gameId;
}

const playersOf = async (slug: string) => (await getDb().select().from(replays).where(eq(replays.slug, slug)))[0].players as any[];
const statsOf = async (gameId: string, playerId: string) =>
  (await getDb().select().from(matchPlayers).where(and(eq(matchPlayers.gameId, gameId), eq(matchPlayers.playerId, playerId))))[0];

describe('upload of a new-shape (leaders[]) replay', () => {
  it('stores both seats\' leaders on replays.players and match_players', async () => {
    const res = await upload(new Request('http://test/api/replays', {
      method: 'POST',
      body: JSON.stringify({ installToken: 'kbx_new', payload: JSON.stringify(leaderShapePayload('new', { gameId: 'g-upload' })) }),
    }));
    const { slug } = await res.json();
    const players = await playersOf(slug);
    const p2 = players.find((p) => p.id === 'p2');
    expect(players.find((p) => p.id === 'p1').leader).toEqual({ name: 'Darth Vader', set: 'SOR', number: 10 });
    expect(p2.leader).toEqual({ name: 'Luke Skywalker', set: 'SOR', number: 5 });
    expect(p2.secondLeader).toEqual({ name: 'Leia Organa', set: 'SOR', number: 9 });
    expect(await statsOf('g-upload', 'p1')).toMatchObject({ leader: 'SOR_010', opponentLeader: 'SOR_005' });
    expect(await statsOf('g-upload', 'p2')).toMatchObject({ leader: 'SOR_005', opponentLeader: 'SOR_010' });
  });
});

describe('backfillLeaders', () => {
  it('dry run reports but writes nothing; --write fixes; a re-run finds nothing', async () => {
    const gameId = await seedBroken('broken-new', leaderShapePayload('new'));
    const lines: string[] = [];

    const dry = await backfillLeaders({ write: false, log: (l) => lines.push(l) });
    expect(dry).toMatchObject({ found: 1, fixed: 1, partial: 0, unresolvable: 0 });
    expect(lines.join('\n')).toContain('players[p2].leader → Luke Skywalker (SOR_005) + Leia Organa');
    expect((await playersOf('broken-new')).every((p) => p.leader === null)).toBe(true);
    expect((await statsOf(gameId, 'p1')).leader).toBeNull();

    const wrote = await backfillLeaders({ write: true });
    expect(wrote).toMatchObject({ found: 1, fixed: 1 });
    const players = await playersOf('broken-new');
    expect(players.find((p) => p.id === 'p1')).toMatchObject({ username: 'Alice', leader: { name: 'Darth Vader', set: 'SOR', number: 10 } });
    expect(players.find((p) => p.id === 'p2')).toMatchObject({ leader: { name: 'Luke Skywalker' }, secondLeader: { name: 'Leia Organa' } });
    expect(await statsOf(gameId, 'p1')).toMatchObject({ leader: 'SOR_010', opponentLeader: 'SOR_005' });
    const p2 = await statsOf(gameId, 'p2');
    expect(p2).toMatchObject({ leader: 'SOR_005', opponentLeader: 'SOR_010', won: false, isRecorder: false });
    expect(new Set(p2.aspects)).toEqual(new Set(['vigilance', 'heroism', 'command']));

    expect(await backfillLeaders({ write: true })).toMatchObject({ found: 0, fixed: 0 });
  });

  it('never overwrites a leader that is already set', async () => {
    const gameId = await seedBroken('half', leaderShapePayload('new'));
    await getDb().update(matchPlayers).set({ leader: 'JTL_001' }).where(and(eq(matchPlayers.gameId, gameId), eq(matchPlayers.playerId, 'p1')));
    await backfillLeaders({ write: true });
    expect(await statsOf(gameId, 'p1')).toMatchObject({ leader: 'JTL_001', opponentLeader: 'SOR_005' });
  });

  it('counts unresolvable rows (pruned payload, payload with no leaders) and skips pre-break rows', async () => {
    const noLeaders = leaderShapePayload('new');
    for (const p of Object.values((noLeaders.events[0].args[0] as any).full.players) as any[]) p.leaders = [];
    delete (noLeaders.events[1].args[0] as any).patch['players/p1/leaders'];
    await seedBroken('no-leaders', noLeaders);
    await seedBroken('pruned', leaderShapePayload('new'), { payloadPrunedAt: new Date() });
    await seedBroken('old-row', leaderShapePayload('old'), { createdAt: new Date('2026-09-01T00:00:00Z') });

    const s = await backfillLeaders({ write: true });
    expect(s).toMatchObject({ found: 2, fixed: 0, unresolvable: 2, reasons: { 'payload pruned': 1, 'no leaders in payload': 1 } });
    expect((await playersOf('old-row')).every((p) => p.leader === null)).toBe(true);
  });

  it('pages through more rows than one batch and honours --limit', async () => {
    for (const slug of ['b1', 'b2', 'b3']) await seedBroken(slug, leaderShapePayload('new', { gameId: `g-${slug}` }));
    expect(await backfillLeaders({ write: false, batchSize: 2 })).toMatchObject({ found: 3, fixed: 3 });
    expect(await backfillLeaders({ write: true, batchSize: 1, limit: 2 })).toMatchObject({ found: 2, fixed: 2 });
    expect(await backfillLeaders({ write: true })).toMatchObject({ found: 1, fixed: 1 });
  });
});
