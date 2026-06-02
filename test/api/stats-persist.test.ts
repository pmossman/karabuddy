import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db';
import { replays, matches, matchPlayers, cardEvents, cards } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { persistReplayFacts } from '@/lib/statsPersist';

// B101/P0: persisting mined facts is idempotent on gameId and self-heals the
// card catalog. Runs on pglite (real Postgres semantics: FKs, transactions,
// onConflictDoNothing).

const card = (set: string, num: number, uuid: string, extra: any = {}) => ({
  uuid,
  setId: { set, number: num },
  id: `${set}_${String(num).padStart(3, '0')}`,
  ...extra,
});
const piles = (zones: Record<string, any[]>) => ({ cardPiles: zones });

function decodedFixture() {
  const draw = card('SOR', 100, 'd', { name: 'Drawn Card', aspects: ['command'], cost: 2, type: 'unit' });
  const play = card('SOR', 102, 'p', { name: 'Played Card', aspects: ['vigilance'], cost: 4, type: 'unit' });
  const frames = [
    {
      t: 0,
      state: {
        players: {
          p1: {
            user: { username: 'Alice' },
            leader: { setId: { set: 'SOR', number: 1 }, aspects: ['command', 'heroism'] },
            base: { setId: { set: 'SOR', number: 20 }, aspects: ['command'] },
            ...piles({ deck: [draw, play], hand: [], groundArena: [] }),
          },
          p2: {
            user: { username: 'Bob' },
            leader: { setId: { set: 'SHD', number: 5 }, aspects: ['aggression'] },
            base: { setId: { set: 'SHD', number: 9 }, aspects: ['aggression'] },
            ...piles({}),
          },
        },
      },
    },
    {
      t: 1,
      state: {
        players: {
          p1: { ...piles({ deck: [], hand: [draw, play], groundArena: [] }) }, // both drawn
          p2: { ...piles({}) },
        },
      },
    },
    {
      t: 2,
      state: {
        players: {
          // Real gamestates carry leader/base/user on every frame; the match
          // fact reads the FINAL frame, so identity must be present here.
          p1: {
            user: { username: 'Alice' },
            leader: { setId: { set: 'SOR', number: 1 }, aspects: ['command', 'heroism'] },
            base: { setId: { set: 'SOR', number: 20 }, aspects: ['command'] },
            ...piles({ deck: [], hand: [draw], groundArena: [play] }), // play → arena
          },
          p2: {
            user: { username: 'Bob' },
            leader: { setId: { set: 'SHD', number: 5 }, aspects: ['aggression'] },
            base: { setId: { set: 'SHD', number: 9 }, aspects: ['aggression'] },
            ...piles({}),
          },
        },
      },
    },
  ];
  return { frames, sideEvents: [], activeByFrame: [], messagesByFrame: [], meta: { version: 2, match: { gameFormat: 'premier' } }, tags: [] } as any;
}

async function seedReplay(gameId: string) {
  const slug = 'r_' + randomUUID().slice(0, 8);
  await getDb().insert(replays).values({
    slug, gameId, ownerToken: 'kbx_' + randomUUID(), players: [],
    payloadBlobUrl: 'memory://x', durationMs: 1,
  });
  return slug;
}

describe('persistReplayFacts', () => {
  it('writes match + players + card events + self-heals the catalog', async () => {
    const gameId = 'gp-' + randomUUID().slice(0, 6);
    const slug = await seedReplay(gameId);
    const res = await persistReplayFacts({ decoded: decodedFixture(), replaySlug: slug, gameId, winners: ['p1'], ownerPlayerId: 'p1', durationMs: 1 });
    expect(res.matchWritten).toBe(true);

    const db = getDb();
    const m = await db.select().from(matches).where(eq(matches.gameId, gameId));
    expect(m).toHaveLength(1);
    expect(m[0].format).toBe('premier');
    expect(m[0].result).toBe('decisive');

    const mp = await db.select().from(matchPlayers).where(eq(matchPlayers.gameId, gameId));
    expect(mp).toHaveLength(2);
    const alice = mp.find((p) => p.playerId === 'p1')!;
    expect(alice.leader).toBe('SOR_001');
    expect(alice.won).toBe(true);
    expect(alice.opponentLeader).toBe('SHD_005'); // denormalized opponent
    expect(alice.isRecorder).toBe(true);

    const ev = await db.select().from(cardEvents).where(eq(cardEvents.gameId, gameId));
    const kinds = ev.map((e) => `${e.cardId}:${e.event}`).sort();
    expect(kinds).toEqual(['SOR_100:drawn', 'SOR_102:drawn', 'SOR_102:played']);

    // Catalog self-heal: the two observed cards registered with payload metadata.
    const cat = await db.select().from(cards).where(eq(cards.cardId, 'SOR_102'));
    expect(cat[0]).toMatchObject({ name: 'Played Card', cost: 4, type: 'unit', source: 'observed' });
  });

  it('is idempotent on gameId — re-persist replaces, never duplicates', async () => {
    const gameId = 'gp-' + randomUUID().slice(0, 6);
    const slug = await seedReplay(gameId);
    const args = { decoded: decodedFixture(), replaySlug: slug, gameId, winners: ['p1'] as string[], ownerPlayerId: 'p1', durationMs: 1 };
    await persistReplayFacts(args);
    await persistReplayFacts(args); // again

    const db = getDb();
    expect(await db.select().from(matches).where(eq(matches.gameId, gameId))).toHaveLength(1);
    expect(await db.select().from(matchPlayers).where(eq(matchPlayers.gameId, gameId))).toHaveLength(2);
    const ev = await db.select().from(cardEvents).where(eq(cardEvents.gameId, gameId));
    expect(ev).toHaveLength(3); // not 6
  });
});
