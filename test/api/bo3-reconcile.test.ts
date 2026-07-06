import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db';
import { replays, matches } from '@/lib/schema';
import { eq, inArray } from 'drizzle-orm';
import { reconcileLobbyBo3 } from '@/lib/bo3Reconcile';

// B224: the stats bo3 flag is reclassified conversion-aware — a Bo1 that
// karabast turned into a Bo3 (its game 1, recorded bestOfOne) becomes Bo3.

const ME = 'me-player';
let t = 1;

async function seedGame(o: {
  lobbyId: string; slug: string; fmt: string; won: boolean | null; bo3: boolean;
  recorder?: string;
}) {
  const db = getDb();
  const gameId = `game-${o.slug}`;
  await db.insert(replays).values({
    slug: o.slug,
    gameId,
    ownerToken: o.recorder ?? 'rec-1',
    players: [],
    payloadBlobUrl: 'blob://x',
    match: { lobbyId: o.lobbyId, gamesToWinMode: o.fmt },
    winners: o.won === null ? null : o.won ? [ME] : ['them'],
    ownerPlayerId: ME,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, t++)),
  });
  await db.insert(matches).values({ gameId, replaySlug: o.slug, result: 'decisive', bo3: o.bo3 });
  return o.slug;
}

const bo3Of = async (slug: string) => {
  const [m] = await getDb().select({ bo3: matches.bo3 }).from(matches).where(eq(matches.replaySlug, slug));
  return m.bo3;
};

describe('reconcileLobbyBo3', () => {
  it('reclassifies a converted Bo1 game 1 (recorded bestOfOne) as Bo3', async () => {
    const lobby = `lob-${randomUUID()}`;
    // [bo1(win), bo3(win)] = a converted 2-0 set; game 1 wrongly stored bo3=false
    const g1 = await seedGame({ lobbyId: lobby, slug: `s-${randomUUID()}`, fmt: 'bestOfOne', won: true, bo3: false });
    const g2 = await seedGame({ lobbyId: lobby, slug: `s-${randomUUID()}`, fmt: 'bestOfThree', won: true, bo3: true });

    const updated = await reconcileLobbyBo3(lobby);
    expect(updated).toBe(1); // only game 1 flips
    expect(await bo3Of(g1)).toBe(true);
    expect(await bo3Of(g2)).toBe(true);
  });

  it('leaves a standalone Bo1 (not followed by Bo3) as Bo1', async () => {
    const lobby = `lob-${randomUUID()}`;
    // [bo1, bo1, bo3]: game 1 standalone, game 2 converted, game 3 Bo3
    const g1 = await seedGame({ lobbyId: lobby, slug: `s-${randomUUID()}`, fmt: 'bestOfOne', won: true, bo3: false });
    const g2 = await seedGame({ lobbyId: lobby, slug: `s-${randomUUID()}`, fmt: 'bestOfOne', won: true, bo3: false });
    const g3 = await seedGame({ lobbyId: lobby, slug: `s-${randomUUID()}`, fmt: 'bestOfThree', won: true, bo3: true });

    const updated = await reconcileLobbyBo3(lobby);
    expect(updated).toBe(1); // only game 2 flips
    expect(await bo3Of(g1)).toBe(false); // standalone Bo1 untouched
    expect(await bo3Of(g2)).toBe(true); // converted game 1
    expect(await bo3Of(g3)).toBe(true);
  });

  it('is idempotent — a second run changes nothing', async () => {
    const lobby = `lob-${randomUUID()}`;
    await seedGame({ lobbyId: lobby, slug: `s-${randomUUID()}`, fmt: 'bestOfOne', won: true, bo3: false });
    await seedGame({ lobbyId: lobby, slug: `s-${randomUUID()}`, fmt: 'bestOfThree', won: false, bo3: true });
    await seedGame({ lobbyId: lobby, slug: `s-${randomUUID()}`, fmt: 'bestOfThree', won: true, bo3: true });
    expect(await reconcileLobbyBo3(lobby)).toBe(1);
    expect(await reconcileLobbyBo3(lobby)).toBe(0);
  });
});
