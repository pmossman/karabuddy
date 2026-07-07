import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { GET as cardPlays } from '@/app/api/teams/[slug]/card-plays/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, replays, matches, cardEvents, replayTeamShares } from '@/lib/schema';

// B226: card finder — the team's replays where a TEAMMATE (recorder) played a
// card, mapped to the first play frame; team-scoped and member-only.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const as = (id: string | null) => vi.mocked(auth).mockResolvedValue(id ? ({ user: { id } } as any) : (null as any));

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
const call = async (team: string, cardId: string) =>
  (await cardPlays(new Request(`http://t/api/teams/${team}/card-plays?cardId=${cardId}`), params(team))).json();

async function seedUser() {
  const id = randomUUID();
  await getDb().insert(users).values({ id, name: id.slice(0, 4), email: `${id}@e.com` });
  return id;
}
async function seedTeam(owner: string) {
  const slug = randomUUID().slice(0, 6);
  await getDb().insert(teams).values({ slug, name: slug, createdBy: owner });
  await getDb().insert(teamMembers).values({ teamSlug: slug, userId: owner, role: 'owner' });
  return slug;
}
// A recorded game: replay (ownerPlayerId = recorder's karabast player) + its
// stats match, optionally shared to a team, with a set of card plays.
async function seedGame(opts: {
  owner: string; team?: string; ownerPlayerId: string;
  plays: { cardId: string; playerId: string; frame: number; event?: string }[];
}) {
  const slug = randomUUID().slice(0, 8);
  const gameId = randomUUID();
  await getDb().insert(replays).values({
    slug, gameId, ownerToken: `kbx_${randomUUID()}`, userId: opts.owner,
    players: [], payloadBlobUrl: 'blob://x', ownerPlayerId: opts.ownerPlayerId,
  });
  await getDb().insert(matches).values({ gameId, replaySlug: slug, result: 'decisive' });
  if (opts.plays.length) {
    await getDb().insert(cardEvents).values(opts.plays.map((p) => ({
      gameId, playerId: p.playerId, cardId: p.cardId, event: p.event ?? 'played', frameIndex: p.frame, attribution: 'both',
    })));
  }
  if (opts.team) await getDb().insert(replayTeamShares).values({ replaySlug: slug, teamSlug: opts.team, sharedBy: opts.owner });
  return slug;
}

beforeEach(() => vi.mocked(auth).mockReset());

describe('GET /api/teams/[slug]/card-plays', () => {
  it('returns the recorder-side plays scoped to the team, at the first frame', async () => {
    const owner = await seedUser();
    const team = await seedTeam(owner);
    as(owner);

    const CARD = 'ASH_148';
    // (a) recorder played it twice → first frame wins
    const a = await seedGame({ owner, team, ownerPlayerId: 'P', plays: [
      { cardId: CARD, playerId: 'P', frame: 40 }, { cardId: CARD, playerId: 'P', frame: 12 },
    ] });
    // (b) only the OPPONENT played it → excluded (team-side only)
    const b = await seedGame({ owner, team, ownerPlayerId: 'P', plays: [{ cardId: CARD, playerId: 'ENEMY', frame: 8 }] });
    // (c) recorder played it but the replay is NOT shared to the team → excluded
    const c = await seedGame({ owner, ownerPlayerId: 'P', plays: [{ cardId: CARD, playerId: 'P', frame: 5 }] });
    // (d) recorder played a DIFFERENT card → excluded
    const d = await seedGame({ owner, team, ownerPlayerId: 'P', plays: [{ cardId: 'OTHER_001', playerId: 'P', frame: 3 }] });

    const j = await call(team, CARD);
    expect(j.ok).toBe(true);
    expect(j.plays[a]).toBe(11); // one frame BEFORE the first play (12)
    expect(j.plays[b]).toBeUndefined();
    expect(j.plays[c]).toBeUndefined();
    expect(j.plays[d]).toBeUndefined();
    expect(Object.keys(j.plays)).toEqual([a]);
  });

  it('filters by event — resourced vs played are separate', async () => {
    const owner = await seedUser();
    const team = await seedTeam(owner);
    as(owner);
    const CARD = 'ASH_148';
    // one game the recorder RESOURCED the card (frame 6), another PLAYED it (frame 20)
    const resGame = await seedGame({ owner, team, ownerPlayerId: 'P', plays: [{ cardId: CARD, playerId: 'P', frame: 6, event: 'resourced' }] });
    const playGame = await seedGame({ owner, team, ownerPlayerId: 'P', plays: [{ cardId: CARD, playerId: 'P', frame: 20, event: 'played' }] });

    const resourced = await (await cardPlays(new Request(`http://t/api/teams/${team}/card-plays?cardId=${CARD}&event=resourced`), params(team))).json();
    expect(Object.keys(resourced.plays)).toEqual([resGame]);
    expect(resourced.plays[resGame]).toBe(5); // one before frame 6

    const played = await (await cardPlays(new Request(`http://t/api/teams/${team}/card-plays?cardId=${CARD}&event=played`), params(team))).json();
    expect(Object.keys(played.plays)).toEqual([playGame]);

    const bad = await (await cardPlays(new Request(`http://t/api/teams/${team}/card-plays?cardId=${CARD}&event=bogus`), params(team))).json();
    expect(bad.ok).toBe(false);
  });

  it('is member-only and requires a cardId', async () => {
    const owner = await seedUser();
    const team = await seedTeam(owner);

    as(null);
    expect((await call(team, 'ASH_148')).ok).toBeFalsy();

    const outsider = await seedUser();
    as(outsider);
    expect((await call(team, 'ASH_148')).ok).toBeFalsy();

    as(owner);
    const noCard = await (await cardPlays(new Request(`http://t/api/teams/${team}/card-plays`), params(team))).json();
    expect(noCard.ok).toBe(false);
  });
});
