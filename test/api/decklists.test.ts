import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { POST as upload } from '@/app/api/replays/route';
import { GET as getReplay } from '@/app/api/replays/[slug]/route';
import { getDb } from '@/lib/db';
import { cards, clips, decklists, extensionTokens, matches, replays, users } from '@/lib/schema';
import { hydrateDecks, normalizeDecklist } from '@/lib/decklists';
import { deleteExpiredReplayRows } from '@/lib/replayRetention';

// B236: decklists stored once (content-addressed), replays keep refs; readers
// get the old embedded shape back from the hydrator. The SQL backfill must hash
// exactly like the TypeScript.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const as = (id: string | null) => vi.mocked(auth).mockResolvedValue(id ? ({ user: { id } } as any) : (null as any));

const DECKS = {
  p1: {
    username: 'me', name: "Parker's Vader",
    leader: { id: 'SOR_010', count: 1, cost: null, internalName: '111' },
    base: { id: 'SOR_020', count: 1, cost: null, internalName: '222' },
    deck: [
      { id: 'SOR_100', count: 3, cost: 2, internalName: 'a' },
      { id: 'SOR_050', count: 2, cost: 5, internalName: 'b' },
      { id: 'JTL_001', count: 1, cost: 7, internalName: 'c' },
    ],
    sideboard: [{ id: 'SOR_200', count: 2, cost: 1, internalName: 'd' }],
  },
  p2: { username: 'opp', name: null, leader: { id: 'SHD_001', count: 1 }, base: { id: 'SHD_002', count: 1 }, deck: null, sideboard: null },
};

function payload(gameId: string, decks: any = DECKS) {
  return JSON.stringify({
    version: 2, actionCount: 10, durationMs: 1000, localPlayerId: 'p1',
    match: { lobbyId: 'lobby-' + gameId, gamesToWinMode: 'bestOfOne' },
    decks,
    events: [{ event: 'gamestate', args: [{ full: { id: gameId, players: {
      p1: { user: { username: 'me' }, leader: { name: 'L', setId: { set: 'SOR', number: 10 } }, base: { name: 'B', setId: { set: 'SOR', number: 20 } } },
      p2: { user: { username: 'opp' } },
    } } }] }],
    tags: [],
  });
}

async function seedUser() {
  const id = randomUUID();
  const token = `kbx_${randomUUID()}`;
  await getDb().insert(users).values({ id, name: id.slice(0, 4), email: `${id}@e.com` });
  await getDb().insert(extensionTokens).values({ token, userId: id });
  return { id, token };
}
async function uploadReplay(token: string, gameId = randomUUID(), decks: any = DECKS) {
  const res = await upload(new Request('http://t/api/replays', { method: 'POST', body: JSON.stringify({ installToken: token, payload: payload(gameId, decks) }) }));
  const json = await res.json();
  expect(json.ok).toBe(true);
  return json.slug as string;
}
const row = async (slug: string) => (await getDb().select().from(replays).where(eq(replays.slug, slug)))[0];

beforeEach(async () => {
  vi.mocked(auth).mockReset(); as(null);
  await getDb().insert(cards).values([
    { cardId: 'SOR_100', cost: 2, name: 'Hundred' }, { cardId: 'SOR_050', cost: 5, name: 'Fifty' }, { cardId: 'JTL_001', cost: 7, name: 'One' }, { cardId: 'SOR_200', cost: 1, name: 'Two hundred' },
  ]).onConflictDoNothing();
});

describe('B236 decklists', () => {
  it('upload stores the list once and the row keeps refs; the hydrator rebuilds the old shape', async () => {
    const u = await seedUser();
    const a = await uploadReplay(u.token);
    const b = await uploadReplay(u.token); // same list, second game
    const ra = await row(a);
    expect((ra as any).decks).toBeUndefined(); // column dropped by the contract migration
    const refs = ra.deckRefs as any;
    expect(refs.p1.decklist).toBe(normalizeDecklist(DECKS.p1)!.id);
    expect(refs.p2.decklist).toBeNull(); // masked opponent
    expect(refs.p1.name).toBe("Parker's Vader");
    expect(await getDb().select().from(decklists)).toHaveLength(1); // deduped across a + b
    expect((await row(b)).deckRefs).toEqual(refs);

    const decks = (await hydrateDecks(ra))!;
    expect(decks.p1.leader).toEqual(DECKS.p1.leader);
    expect(decks.p1.deck!.map((c) => [c.id, c.count, c.cost])).toEqual([['JTL_001', 1, 7], ['SOR_050', 2, 5], ['SOR_100', 3, 2]]); // sorted by id, cost re-attached
    expect(decks.p1.sideboard).toEqual([{ id: 'SOR_200', count: 2, cost: 1 }]);
    expect(decks.p2.deck).toBeNull();
  });

  it('GET /api/replays/[slug] still returns decks for the owner', async () => {
    const u = await seedUser();
    const slug = await uploadReplay(u.token);
    as(u.id);
    const res = await getReplay(new Request(`http://t/api/replays/${slug}`), { params: Promise.resolve({ slug }) });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.decks.p1.deck).toHaveLength(3);
    expect(body.data.deckRefs).toBeUndefined();
  });

});

describe('B236 blanket row retention (opt-in)', () => {
  const DAY = 86_400_000;
  it('deletes old rows (cascading stats), keeps public + clipped + recent', async () => {
    const u = await seedUser();
    const old = await uploadReplay(u.token, 'g-old');
    const recent = await uploadReplay(u.token, 'g-recent');
    const pub = await uploadReplay(u.token, 'g-pub');
    const clipped = await uploadReplay(u.token, 'g-clip');
    for (const s of [old, pub, clipped]) await getDb().update(replays).set({ createdAt: new Date(Date.now() - 100 * DAY) }).where(eq(replays.slug, s));
    await getDb().update(replays).set({ publicAt: new Date() }).where(eq(replays.slug, pub));
    await getDb().insert(clips).values({ slug: 'c1', replaySlug: clipped, startFrame: 0, endFrame: 1, createdBy: u.token });

    const dry = await deleteExpiredReplayRows({ days: 90, dryRun: true });
    expect(dry.deleted).toBe(1);
    const res = await deleteExpiredReplayRows({ days: 90 });
    expect(res.deleted).toBe(1);
    expect(await row(old)).toBeUndefined();
    expect(await getDb().select().from(matches).where(eq(matches.gameId, 'g-old'))).toHaveLength(0); // cascaded
    for (const s of [recent, pub, clipped]) expect(await row(s)).toBeDefined();
  });
});
