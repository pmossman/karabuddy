import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { GET as listGet } from '@/app/api/teams/[slug]/sideboard-guides/route';
import { GET as poolGet } from '@/app/api/teams/[slug]/sideboard-guides/pool/route';
import { GET as matchupGet, PUT as matchupPut, DELETE as matchupDel } from '@/app/api/teams/[slug]/sideboard-guides/matchup/route';
import { POST as commentPost } from '@/app/api/teams/[slug]/sideboard-guides/matchup/comments/route';
import { DELETE as commentDel } from '@/app/api/teams/[slug]/sideboard-guides/matchup/comments/[commentId]/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, replays, replayTeamShares } from '@/lib/schema';

// B231: sideboard guides (matchup-takes model) — pool aggregation, one take per
// member, the matchup consensus, matchup-level comments, and the auth boundaries.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const as = (id: string | null) => vi.mocked(auth).mockResolvedValue(id ? ({ user: { id } } as any) : (null as any));

async function seedUser() {
  const id = randomUUID();
  await getDb().insert(users).values({ id, name: id.slice(0, 4), email: `${id}@e.com` });
  return id;
}
async function seedTeam(owner: string, members: string[]) {
  const slug = randomUUID().slice(0, 6);
  await getDb().insert(teams).values({ slug, name: slug, createdBy: owner });
  await getDb().insert(teamMembers).values(members.map((u) => ({ teamSlug: slug, userId: u, role: u === owner ? 'owner' : 'member' })));
  return slug;
}
async function seedReplay(team: string, owner: string, leaderName: string, deckIds: string[]) {
  const slug = randomUUID().slice(0, 8);
  await getDb().insert(replays).values({
    slug, gameId: randomUUID(), ownerToken: `kbx_${randomUUID()}`, userId: owner, ownerPlayerId: 'P',
    players: [{ id: 'P', leader: { name: leaderName, set: 'SOR', number: 1 }, base: { name: 'Base X', set: 'SOR', number: 20 } }, { id: 'Q', leader: { name: 'Opp', set: 'SHD', number: 5 } }],
    payloadBlobUrl: 'blob://x', match: { gameFormat: 'premier' },
    decks: { P: { username: 'r', leader: null, base: null, deck: deckIds.map((id) => ({ id, count: 1 })), sideboard: [] } },
  });
  await getDb().insert(replayTeamShares).values({ replaySlug: slug, teamSlug: team, sharedBy: owner });
}
const MU = { ownLeader: 'Cad Bane', ownBase: 'asp:cunning', oppLeader: 'Ahsoka', oppBase: 'name:Colossus' };
const p = (slug: string) => ({ params: Promise.resolve({ slug }) });
const putReq = (m: any) => new Request('http://t', { method: 'PUT', body: JSON.stringify(m) });
const getMatchup = async (slug: string) => (await matchupGet(new Request(`http://t?${new URLSearchParams(MU)}`), p(slug))).json();

beforeEach(() => vi.mocked(auth).mockReset());

describe('sideboard guides (matchup takes)', () => {
  it('aggregates the pool frequency-sorted; member-only', async () => {
    const owner = await seedUser();
    const team = await seedTeam(owner, [owner]);
    await seedReplay(team, owner, 'Cad Bane', ['ASH_010', 'ASH_020', 'ASH_030']);
    await seedReplay(team, owner, 'Cad Bane', ['ASH_010', 'ASH_020']);
    await seedReplay(team, owner, 'Cad Bane', ['ASH_010']);
    as(owner);
    const j = await (await poolGet(new Request('http://t?ownLeader=Cad+Bane'), p(team))).json();
    expect(j.data.totalLists).toBe(3);
    expect(j.data.cards.map((c: any) => c.cardId)).toEqual(['ASH_010', 'ASH_020', 'ASH_030']);
    as(await seedUser());
    expect((await (await poolGet(new Request('http://t?ownLeader=Cad+Bane'), p(team))).json()).ok).toBeFalsy();
  });

  it('one take per member; the matchup view computes consensus across takes', async () => {
    const a = await seedUser(); const b = await seedUser();
    const team = await seedTeam(a, [a, b]);

    // member A: in ASH_010+ASH_020, out ASH_030
    as(a);
    await matchupPut(putReq({ ...MU, notes: 'race', cardsIn: [{ cardId: 'ASH_010' }, { cardId: 'ASH_020' }], cardsOut: [{ cardId: 'ASH_030' }] }), p(team));
    // upsert: same member re-PUT replaces (still one take)
    await matchupPut(putReq({ ...MU, cardsIn: [{ cardId: 'ASH_010' }], cardsOut: [] }), p(team));
    // member B: in ASH_010 (agrees) + ASH_099
    as(b);
    await matchupPut(putReq({ ...MU, cardsIn: [{ cardId: 'ASH_010' }, { cardId: 'ASH_099' }], cardsOut: [] }), p(team));

    const view = (await getMatchup(team)).data;
    expect(view.takes).toHaveLength(2); // one per member
    expect(view.consensus.total).toBe(2);
    // ASH_010 is in BOTH takes' IN -> 2/2 consensus, first
    expect(view.consensus.inCards[0]).toEqual({ cardId: 'ASH_010', count: 2, qty: 1 });
    expect(view.consensus.inCards.find((c: any) => c.cardId === 'ASH_099').count).toBe(1);
    expect(view.myTake.cardsIn.map((c: any) => c.cardId)).toEqual(['ASH_010', 'ASH_099']); // b's own

    // the matchup shows up in the team list with 2 takes
    const list = (await (await listGet(new Request('http://t'), p(team))).json()).data;
    const mm = list.matchups.find((x: any) => x.ownLeader === 'Cad Bane');
    expect(mm.takeCount).toBe(2);
    expect(mm.myTake).toBe(true); // b viewing

    // A removes their take -> back to 1
    as(a);
    await matchupDel(new Request(`http://t?${new URLSearchParams(MU)}`, { method: 'DELETE' }), p(team));
    expect((await getMatchup(team)).data.takes).toHaveLength(1);
  });

  it('persists per-card quantities (clamped 1..3) and surfaces them in the take + consensus', async () => {
    const a = await seedUser();
    const team = await seedTeam(a, [a]);
    as(a);
    await matchupPut(putReq({ ...MU, notes: '+2/-2 swap', cardsIn: [{ cardId: 'ASH_010', qty: 2 }, { cardId: 'ASH_020', qty: 9 }], cardsOut: [{ cardId: 'ASH_030', qty: 2 }] }), p(team));
    const view = (await getMatchup(team)).data;
    const inById = Object.fromEntries(view.myTake.cardsIn.map((c: any) => [c.cardId, c.qty]));
    expect(inById.ASH_010).toBe(2);
    expect(inById.ASH_020).toBe(3); // clamped from 9 to the 3-copy max
    expect(view.myTake.cardsOut[0].qty).toBe(2);
    expect(view.consensus.inCards.find((c: any) => c.cardId === 'ASH_010')).toEqual({ cardId: 'ASH_010', count: 1, qty: 2 });
  });

  it('matchup comments: any member posts; poster-only delete; non-member refused', async () => {
    const a = await seedUser(); const b = await seedUser();
    const team = await seedTeam(a, [a, b]);
    as(a); await matchupPut(putReq({ ...MU, cardsIn: [{ cardId: 'ASH_010' }] }), p(team));

    as(b); // non-author member comments
    const c = await (await commentPost(new Request('http://t', { method: 'POST', body: JSON.stringify({ ...MU, body: 'keep 1 top-end' }) }), p(team))).json();
    expect(c.ok).toBe(true);
    expect((await getMatchup(team)).data.comments.map((x: any) => x.body)).toContain('keep 1 top-end');

    const delReq = (id: string) => ({ params: Promise.resolve({ slug: team, commentId: id }) });
    as(a); // another member can't delete b's comment
    expect((await (await commentDel(new Request('http://t', { method: 'DELETE' }), delReq(c.data.id))).json()).ok).toBeFalsy();
    as(b);
    expect((await (await commentDel(new Request('http://t', { method: 'DELETE' }), delReq(c.data.id))).json()).ok).toBe(true);

    as(await seedUser()); // non-member
    expect((await (await commentPost(new Request('http://t', { method: 'POST', body: JSON.stringify({ ...MU, body: 'x' }) }), p(team))).json()).ok).toBeFalsy();
  });

  it('stores the authoring baseline decklist (sanitized) with the take; pool-authored is null', async () => {
    const a = await seedUser();
    const team = await seedTeam(a, [a]);
    as(a);
    await matchupPut(putReq({ ...MU, cardsIn: [{ cardId: 'ASH_099' }], cardsOut: [{ cardId: 'ASH_010' }],
      baseline: { main: [{ cardId: 'ASH_010', count: 3 }, { cardId: 'BAD', count: 99 }, { cardId: '  ', count: 1 }], sideboard: [{ cardId: 'ASH_099', count: 2 }] } }), p(team));
    const view = (await getMatchup(team)).data;
    // Counts clamp to 1..9, blank ids drop.
    expect(view.myTake.baseline.main).toEqual([{ cardId: 'ASH_010', count: 3 }, { cardId: 'BAD', count: 9 }]);
    expect(view.myTake.baseline.sideboard).toEqual([{ cardId: 'ASH_099', count: 2 }]);

    // Re-saving without a baseline (pool-authored) clears it.
    await matchupPut(putReq({ ...MU, cardsIn: [{ cardId: 'ASH_020' }] }), p(team));
    expect((await getMatchup(team)).data.myTake.baseline).toBeNull();
  });
});
