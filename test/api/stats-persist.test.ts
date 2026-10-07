import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db';
import { replays, matches, matchPlayers, cards } from '@/lib/schema';
import { and, eq } from 'drizzle-orm';
import { persistReplayFacts } from '@/lib/statsPersist';
import { persistReplayStats } from '@/lib/replayStatsPersist';
import { setReplayResult } from '@/lib/replayResult';
import { putPayload } from '@/lib/blob';

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
        // B230: 'played' now comes from the game log ("plays <card>"), not arena entry.
        newMessages: [{ message: [{ type: 'player' }, ' plays ', { setId: { set: 'SOR', number: 102 }, uuid: 'p', controllerId: 'p1' }] }],
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

    // B235: card facts live on the side's row as event → cardId → first frame.
    const kinds = Object.entries(alice.cardEvents ?? {}).flatMap(([ev, m]) => Object.keys(m!).map((c) => `${c}:${ev}`)).sort();
    expect(kinds).toEqual(['SOR_100:drawn', 'SOR_102:drawn', 'SOR_102:played']);
    expect(alice.cardEvents!.played!.SOR_102).toBeGreaterThanOrEqual(alice.cardEvents!.drawn!.SOR_102); // played after drawn
    const bob = mp.find((p) => p.playerId === 'p2')!;
    expect(bob.cardEvents).toBeNull(); // B237: facts only for recorded seats
    expect(bob.isRecorder).toBe(false);

    // Catalog self-heal: the two observed cards registered with payload metadata.
    const cat = await db.select().from(cards).where(eq(cards.cardId, 'SOR_102'));
    expect(cat[0]).toMatchObject({ name: 'Played Card', cost: 4, type: 'unit', source: 'observed' });
  });

  it('co-recorded game: the earlier recorder keeps its facts when the opponent persists later (B237)', async () => {
    const gameId = 'gco-' + randomUUID().slice(0, 6);
    const slugA = await seedReplay(gameId);
    const slugB = await seedReplay(gameId);
    // Alice (p1) uploads first, then Bob (p2) uploads his own recording of the same game.
    await persistReplayFacts({ decoded: decodedFixture(), replaySlug: slugA, gameId, winners: ['p1'], ownerPlayerId: 'p1', durationMs: 1 });
    await persistReplayFacts({ decoded: decodedFixture(), replaySlug: slugB, gameId, winners: ['p1'], ownerPlayerId: 'p2', durationMs: 1 });
    const db = getDb();
    const mp = await db.select().from(matchPlayers).where(eq(matchPlayers.gameId, gameId));
    const alice = mp.find((p) => p.playerId === 'p1')!;
    const bob = mp.find((p) => p.playerId === 'p2')!;
    expect(bob.isRecorder).toBe(true);
    expect(alice.isRecorder).toBe(true); // carried over: she recorded earlier
    expect(alice.cardEvents?.drawn).toBeDefined(); // her full facts survived the replace
    expect(bob.cardEvents).toBeDefined();
  });

  it('writes a resourcing rating on the recorder row only (≥1 counted round)', async () => {
    // Minimal phase-bearing fixture: 3 action spans (regroup between), the
    // recorder floats 2 in R2 with a play (underspend); R3 is the decided round.
    const c = (n: number, uuid: string) => card('SOR', n, uuid);
    const me = (zones: Record<string, any[]>, avail: number) => ({
      user: { username: 'Rec' }, leader: { setId: { set: 'SOR', number: 1 } }, base: { setId: { set: 'SOR', number: 20 } },
      availableResources: avail, ...piles(zones),
    });
    const opp = { user: { username: 'Opp' }, leader: { setId: { set: 'SHD', number: 5 } }, base: { setId: { set: 'SHD', number: 9 } }, ...piles({}) };
    const F = (phase: string, zones: Record<string, any[]>, avail: number) => ({ t: 0, state: { phase, newMessages: [], players: { p1: me(zones, avail), p2: opp } } });
    const frames = [
      F('action', { deck: [c(102, 'p')], hand: [c(101, 'h')], resources: [], groundArena: [] }, 0), // R1
      F('regroup', {}, 0),
      F('action', { hand: [c(101, 'h')], resources: [c(103, 'r')], groundArena: [c(102, 'p')] }, 2), // R2 played p, float 2
      F('regroup', {}, 0),
      F('action', { hand: [c(101, 'h')], resources: [c(103, 'r')], groundArena: [c(102, 'p')] }, 4), // R3 final (dropped)
    ];
    const decoded = { frames, sideEvents: [], activeByFrame: [], messagesByFrame: [], meta: { version: 2, match: { gameFormat: 'premier' } }, tags: [] } as any;
    const gameId = 'gr-' + randomUUID().slice(0, 6);
    const slug = await seedReplay(gameId);
    await persistReplayFacts({ decoded, replaySlug: slug, gameId, winners: ['p1'], ownerPlayerId: 'p1', durationMs: 1 });

    const mp = await getDb().select().from(matchPlayers).where(eq(matchPlayers.gameId, gameId));
    const rec = mp.find((p) => p.isRecorder)!;
    const other = mp.find((p) => !p.isRecorder)!;
    expect(rec.resourceCountedRounds).toBeGreaterThan(0);
    expect(rec.resourceAvailable).not.toBeNull();
    expect(rec.resourceUnderspend).toBe(2); // R2 float, not final/initiative
    expect(other.resourceAvailable).toBeNull(); // opponent never rated
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
    // Replace-style write: the maps don't accumulate across re-persists.
    const [alice] = await db.select().from(matchPlayers).where(and(eq(matchPlayers.gameId, gameId), eq(matchPlayers.playerId, 'p1')));
    expect(Object.values(alice.cardEvents ?? {}).reduce((n, m) => n + Object.keys(m!).length, 0)).toBe(3); // not 6
  });
});

// The same fixture with p2 drawing a card too, so BOTH recorders have card facts
// of their own (each upload only carries its own seat's drawn/resourced).
function coRecordedFixture() {
  const d = decodedFixture();
  const bobCard = card('SHD', 50, 'q', { name: 'Bob Card', type: 'unit' });
  d.frames[0].state.players.p2.cardPiles = { deck: [bobCard], hand: [] };
  d.frames[1].state.players.p2.cardPiles = { deck: [], hand: [bobCard] };
  d.frames[2].state.players.p2.cardPiles = { deck: [], hand: [bobCard] };
  return d;
}
const seatsOf = async (gameId: string) => {
  const mp = await getDb().select().from(matchPlayers).where(eq(matchPlayers.gameId, gameId));
  return { p1: mp.find((r) => r.playerId === 'p1')!, p2: mp.find((r) => r.playerId === 'p2')!, count: mp.length };
};

describe('persistReplayFacts — two uploads of the same game at once', () => {
  // Both players of a co-recorded game upload the moment it ends. The old
  // read/delete/re-insert raced: one persist threw matches_pkey (or a
  // match_players FK/PK error) and that recorder's facts were lost. Start both in
  // the same tick, offset by 0..8 microtask hops, to walk the interleavings.
  for (const hops of [0, 1, 2, 3, 4, 6, 8]) {
    it(`both persists succeed and both recorders keep their facts (B starts ${hops} hops later)`, async () => {
      const gameId = 'race-' + randomUUID().slice(0, 6);
      const slugA = await seedReplay(gameId);
      const slugB = await seedReplay(gameId);
      const persist = async (slug: string, seat: string, n: number) => {
        for (let i = 0; i < n; i++) await Promise.resolve();
        return persistReplayFacts({ decoded: coRecordedFixture(), replaySlug: slug, gameId, winners: ['p1'], ownerPlayerId: seat, durationMs: 1 });
      };
      const results = await Promise.allSettled([persist(slugA, 'p1', 0), persist(slugB, 'p2', hops)]);
      expect(results.map((r) => (r.status === 'rejected' ? String((r.reason as any)?.cause?.message ?? r.reason) : 'ok'))).toEqual(['ok', 'ok']);

      expect(await getDb().select().from(matches).where(eq(matches.gameId, gameId))).toHaveLength(1);
      const { p1, p2, count } = await seatsOf(gameId);
      expect(count).toBe(2);
      expect(p1).toMatchObject({ isRecorder: true, won: true, leader: 'SOR_001' });
      expect(p2).toMatchObject({ isRecorder: true, won: false, leader: 'SHD_005' });
      expect(Object.keys(p1.cardEvents?.drawn ?? {})).toEqual(expect.arrayContaining(['SOR_100', 'SOR_102']));
      expect(Object.keys(p2.cardEvents?.drawn ?? {})).toEqual(['SHD_050']);
    });
  }
});

describe('persistReplayFacts — re-persisting an existing game', () => {
  it('keeps matches.created_at (the date filters key on it) while refreshing the facts', async () => {
    const gameId = 'gc-' + randomUUID().slice(0, 6);
    const slug = await seedReplay(gameId);
    await persistReplayFacts({ decoded: decodedFixture(), replaySlug: slug, gameId, winners: null, ownerPlayerId: 'p1', durationMs: 1 });
    const playedAt = new Date('2026-10-07T03:00:00Z');
    await getDb().update(matches).set({ createdAt: playedAt }).where(eq(matches.gameId, gameId));

    // e.g. a manual result days later, or backfill-stats --force.
    await persistReplayFacts({ decoded: decodedFixture(), replaySlug: slug, gameId, winners: ['p2'], ownerPlayerId: 'p1', durationMs: 1 });
    const [m] = await getDb().select().from(matches).where(eq(matches.gameId, gameId));
    expect(m.createdAt.toISOString()).toBe(playedAt.toISOString());
    expect(m.result).toBe('decisive');
    const { p1, p2 } = await seatsOf(gameId);
    expect([p1.won, p2.won]).toEqual([false, true]);
  });

  it('a later upload from the OTHER seat keeps the earlier recorder\'s resourcing rating', async () => {
    // Rated recorder fixture (as in the resourcing test above): p1 floats 2 in R2.
    const c = (n: number, uuid: string) => card('SOR', n, uuid);
    const me = (zones: Record<string, any[]>, avail: number) => ({
      user: { username: 'Rec' }, leader: { setId: { set: 'SOR', number: 1 } }, base: { setId: { set: 'SOR', number: 20 } },
      availableResources: avail, ...piles(zones),
    });
    const opp = { user: { username: 'Opp' }, leader: { setId: { set: 'SHD', number: 5 } }, base: { setId: { set: 'SHD', number: 9 } }, ...piles({}) };
    const F = (phase: string, zones: Record<string, any[]>, avail: number) => ({ t: 0, state: { phase, newMessages: [], players: { p1: me(zones, avail), p2: opp } } });
    const frames = [
      F('action', { deck: [c(102, 'p')], hand: [c(101, 'h')], resources: [], groundArena: [] }, 0),
      F('regroup', {}, 0),
      F('action', { hand: [c(101, 'h')], resources: [c(103, 'r')], groundArena: [c(102, 'p')] }, 2),
      F('regroup', {}, 0),
      F('action', { hand: [c(101, 'h')], resources: [c(103, 'r')], groundArena: [c(102, 'p')] }, 4),
    ];
    const decoded = { frames, sideEvents: [], activeByFrame: [], messagesByFrame: [], meta: { version: 2, match: { gameFormat: 'premier' } }, tags: [] } as any;
    const gameId = 'gr2-' + randomUUID().slice(0, 6);
    const slugA = await seedReplay(gameId);
    const slugB = await seedReplay(gameId);
    await persistReplayFacts({ decoded, replaySlug: slugA, gameId, winners: ['p1'], ownerPlayerId: 'p1', durationMs: 1 });
    const rated = (await seatsOf(gameId)).p1;
    expect(rated.resourceUnderspend).toBe(2);

    await persistReplayFacts({ decoded, replaySlug: slugB, gameId, winners: ['p1'], ownerPlayerId: 'p2', durationMs: 1 });
    const { p1, p2 } = await seatsOf(gameId);
    // Before: the carried seat kept its card facts but its rating was wiped.
    expect(p1).toMatchObject({
      isRecorder: true,
      resourceAvailable: rated.resourceAvailable, resourceWasted: rated.resourceWasted, resourceUnderspend: 2,
      resourceCountedRounds: rated.resourceCountedRounds,
    });
    expect(p2.isRecorder).toBe(true);
  });

  it('a seat no upload recorded carries no card facts (B237), even if an old row had some', async () => {
    const gameId = 'gl-' + randomUUID().slice(0, 6);
    const slug = await seedReplay(gameId);
    await persistReplayFacts({ decoded: decodedFixture(), replaySlug: slug, gameId, winners: ['p1'], ownerPlayerId: 'p1', durationMs: 1 });
    // A pre-B237 row: the opponent side kept board-visible facts.
    await getDb().update(matchPlayers).set({ cardEvents: { played: { SHD_099: 4 } } })
      .where(and(eq(matchPlayers.gameId, gameId), eq(matchPlayers.playerId, 'p2')));
    await persistReplayFacts({ decoded: decodedFixture(), replaySlug: slug, gameId, winners: ['p1'], ownerPlayerId: 'p1', durationMs: 1 });
    const { p2 } = await seatsOf(gameId);
    expect(p2).toMatchObject({ isRecorder: false, cardEvents: null });
  });
});

describe('manual result assignment re-persists through the same path', () => {
  // A raw karabast-shaped payload (what the extension uploads), stored in the
  // in-memory blob so setReplayResult can read it back like prod does.
  function rawPayload(gameId: string) {
    const side = (name: string, leader: number, base: number) => ({
      user: { username: name }, leader: { name: 'L', setId: { set: 'SOR', number: leader } }, base: { name: 'B', setId: { set: 'SOR', number: base } },
    });
    return {
      version: 2, actionCount: 10, durationMs: 1000, localPlayerId: 'p1',
      events: [{ event: 'gamestate', args: [{ full: { id: gameId, players: { p1: side('Alice', 1, 20), p2: side('Bob', 5, 21) } } }] }],
      tags: [],
    };
  }

  it('a result set days later keeps the game on the day it was played', async () => {
    const gameId = 'gm-' + randomUUID().slice(0, 6);
    const slug = 'r_' + randomUUID().slice(0, 8);
    const payload = rawPayload(gameId);
    const { url } = await putPayload(`replays/${slug}.json`, JSON.stringify(payload));
    const replay = { slug, gameId, ownerPlayerId: 'p1', players: [{ id: 'p1' }, { id: 'p2' }], payloadBlobUrl: url, encrypted: false };
    await getDb().insert(replays).values({ ...replay, ownerToken: 'kbx_' + randomUUID(), durationMs: 1 });

    // The upload persisted it with no result (karabast "leave game")…
    await persistReplayStats(slug, payload, gameId, null);
    const playedAt = new Date('2026-10-06T22:00:00Z');
    await getDb().update(matches).set({ createdAt: playedAt }).where(eq(matches.gameId, gameId));
    expect((await seatsOf(gameId)).p1.won).toBeNull();

    // …and the owner asserts a win later.
    expect(await setReplayResult(replay, 'win')).toBe('ok');
    const [m] = await getDb().select().from(matches).where(eq(matches.gameId, gameId));
    expect(m.createdAt.toISOString()).toBe(playedAt.toISOString());
    expect(m.result).toBe('decisive');
    const { p1, p2 } = await seatsOf(gameId);
    expect([p1.won, p2.won]).toEqual([true, false]);
    expect(p1.isRecorder).toBe(true);
  });
});

