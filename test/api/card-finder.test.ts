import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { GET as cardPlays } from '@/app/api/card-plays/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, replays, matches, cardEvents, replayTeamShares, cards } from '@/lib/schema';

// B226: card finder — replays where the RECORDER did an event with a card,
// mapped to the frame just before it. One endpoint, two scopes: a team's
// surfaced replays (team=<slug>, member-only) OR the signed-in viewer's own.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const as = (id: string | null) => vi.mocked(auth).mockResolvedValue(id ? ({ user: { id } } as any) : (null as any));

// GET /api/card-plays — team is a query param now (not a path segment).
const req = (qs: string) => cardPlays(new Request(`http://t/api/card-plays?${qs}`));
const call = async (team: string, cardId: string, event?: string) =>
  (await req(`cardId=${cardId}&team=${team}${event ? `&event=${event}` : ''}`)).json();

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

describe('GET /api/card-plays', () => {
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

    const resourced = await (await req(`cardId=${CARD}&team=${team}&event=resourced`)).json();
    expect(Object.keys(resourced.plays)).toEqual([resGame]);
    expect(resourced.plays[resGame]).toBe(5); // one before frame 6

    const played = await (await req(`cardId=${CARD}&team=${team}&event=played`)).json();
    expect(Object.keys(played.plays)).toEqual([playGame]);

    const bad = await (await req(`cardId=${CARD}&team=${team}&event=bogus`)).json();
    expect(bad.ok).toBe(false);
  });

  it('matches across PRINTINGS — a card played as one printing is found via another (B226 fix)', async () => {
    // Same logical card, two printings: the deck-legal base + a promo variant.
    await getDb().insert(cards).values([
      { cardId: 'SEC_068', name: 'Lando Calrissian', subtitle: 'Trust Me', type: 'unit', source: 'seed' },
      { cardId: 'SECOP_003', name: 'Lando Calrissian', subtitle: 'Trust Me', type: 'unit', source: 'seed' },
    ]);
    const owner = await seedUser();
    const team = await seedTeam(owner);
    as(owner);
    // the recorder PLAYED the base printing
    const g = await seedGame({ owner, team, ownerPlayerId: 'P', plays: [{ cardId: 'SEC_068', playerId: 'P', frame: 15 }] });

    // searching the OTHER printing still finds it (identity, not exact cardId)
    const j = await call(team, 'SECOP_003');
    expect(j.ok).toBe(true);
    expect(Object.keys(j.plays)).toEqual([g]);
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
    const noCard = await (await req(`team=${team}`)).json();
    expect(noCard.ok).toBe(false);
  });

  it('personal scope (no team) = the signed-in viewer\'s OWN replays only', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const CARD = 'ASH_148';
    // mine (no team share) + someone else's — same card, both recorder-side
    const mine = await seedGame({ owner: me, ownerPlayerId: 'P', plays: [{ cardId: CARD, playerId: 'P', frame: 30 }] });
    const theirs = await seedGame({ owner: other, ownerPlayerId: 'Q', plays: [{ cardId: CARD, playerId: 'Q', frame: 9 }] });

    as(me);
    const j = await (await req(`cardId=${CARD}`)).json(); // no team → personal
    expect(j.ok).toBe(true);
    expect(Object.keys(j.plays)).toEqual([mine]);
    expect(j.plays[mine]).toBe(29);
    expect(j.plays[theirs]).toBeUndefined();

    // signed out → not allowed
    as(null);
    expect((await (await req(`cardId=${CARD}`)).json()).ok).toBeFalsy();
  });
});
