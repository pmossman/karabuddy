import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { GET as listGet, POST as listPost } from '@/app/api/teams/[slug]/sideboard-guides/route';
import { GET as poolGet } from '@/app/api/teams/[slug]/sideboard-guides/pool/route';
import { GET as oneGet, PATCH as onePatch, DELETE as oneDel } from '@/app/api/sideboard-guides/[id]/route';
import { POST as commentPost } from '@/app/api/sideboard-guides/[id]/comments/route';
import { DELETE as commentDel } from '@/app/api/sideboard-guides/[id]/comments/[commentId]/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, replays, replayTeamShares, cards } from '@/lib/schema';

// B231: sideboard guides — pool aggregation (frequency-sorted from the team's
// decklists), CRUD, and the auth boundaries (member-only view, author-only edit).

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
// A team-shared replay whose recorder played `leader` with the given deck ids.
async function seedReplay(team: string, owner: string, leaderName: string, deckIds: string[], sideIds: string[] = []) {
  const slug = randomUUID().slice(0, 8);
  const pid = 'P';
  await getDb().insert(replays).values({
    slug, gameId: randomUUID(), ownerToken: `kbx_${randomUUID()}`, userId: owner, ownerPlayerId: pid,
    players: [{ id: pid, leader: { name: leaderName, set: 'SOR', number: 1 }, base: { name: 'Base X', set: 'SOR', number: 20 } }, { id: 'Q', leader: { name: 'Opp', set: 'SHD', number: 5 } }],
    payloadBlobUrl: 'blob://x', match: { gameFormat: 'premier' },
    decks: { [pid]: { username: 'r', leader: null, base: null, deck: deckIds.map((id) => ({ id, count: 1 })), sideboard: sideIds.map((id) => ({ id, count: 1 })) } },
  });
  await getDb().insert(replayTeamShares).values({ replaySlug: slug, teamSlug: team, sharedBy: owner });
  return slug;
}
const p = (slug: string) => ({ params: Promise.resolve({ slug }) });
const pid = (id: string) => ({ params: Promise.resolve({ id }) });
const jreq = (body: any, method = 'POST') => new Request('http://t', { method, body: JSON.stringify(body) });

beforeEach(() => vi.mocked(auth).mockReset());

describe('sideboard guides', () => {
  it('aggregates the team card pool frequency-sorted; member-only', async () => {
    const owner = await seedUser();
    const team = await seedTeam(owner, [owner]);
    // three lists: A in all 3, B in 2, C in 1
    await seedReplay(team, owner, 'Cad Bane', ['ASH_010', 'ASH_020', 'ASH_030'], []);
    await seedReplay(team, owner, 'Cad Bane', ['ASH_010', 'ASH_020'], []);
    await seedReplay(team, owner, 'Cad Bane', ['ASH_010']);
    await seedReplay(team, owner, 'Other Leader', ['ZZZ_999']); // different archetype — excluded

    as(owner);
    const res = await poolGet(new Request('http://t?ownLeader=Cad+Bane'), p(team));
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.data.totalLists).toBe(3);
    const ids = j.data.cards.map((c: any) => c.cardId);
    expect(ids).toEqual(['ASH_010', 'ASH_020', 'ASH_030']); // frequency desc
    expect(j.data.cards[0].fraction).toBe(1); // ASH_010 in all 3
    expect(ids).not.toContain('ZZZ_999');

    // non-member is refused
    as(await seedUser());
    expect((await (await poolGet(new Request('http://t?ownLeader=Cad+Bane'), p(team))).json()).ok).toBeFalsy();
  });

  it('creates, lists, gets, updates and deletes a guide (author-only edits)', async () => {
    const author = await seedUser();
    const mate = await seedUser();
    const team = await seedTeam(author, [author, mate]);

    as(author);
    const created = await (await listPost(jreq({
      ownLeader: 'Cad Bane', ownBase: 'Base X', oppLeader: 'Ahsoka', oppBase: 'Base Y',
      title: 'vs aggro', notes: 'race them', cardsIn: [{ cardId: 'ASH_010', note: 'cheap' }], cardsOut: [{ cardId: 'ASH_030' }],
    }), p(team))).json();
    expect(created.ok).toBe(true);
    const id = created.data.id;

    // teammate can view it
    as(mate);
    const got = await (await oneGet(new Request('http://t'), pid(id))).json();
    expect(got.ok).toBe(true);
    expect(got.data.cardsIn[0].cardId).toBe('ASH_010');
    expect(got.data.canEdit).toBe(false); // not the author

    // it shows in the team list
    const list = await (await listGet(new Request('http://t'), p(team))).json();
    expect(list.data.guides.map((g: any) => g.id)).toContain(id);

    // teammate CANNOT edit or delete (author-only)
    expect((await (await onePatch(jreq({ title: 'hijack' }, 'PATCH'), pid(id))).json()).ok).toBeFalsy();
    expect((await (await oneDel(new Request('http://t', { method: 'DELETE' }), pid(id))).json()).ok).toBeFalsy();

    // author edits + deletes
    as(author);
    expect((await (await onePatch(jreq({ title: 'updated', cardsIn: [{ cardId: 'ASH_010' }, { cardId: 'ASH_020' }] }, 'PATCH'), pid(id))).json()).ok).toBe(true);
    const after = await (await oneGet(new Request('http://t'), pid(id))).json();
    expect(after.data.title).toBe('updated');
    expect(after.data.cardsIn).toHaveLength(2);
    expect(after.data.canEdit).toBe(true);
    expect((await (await oneDel(new Request('http://t', { method: 'DELETE' }), pid(id))).json()).ok).toBe(true);
    expect((await (await oneGet(new Request('http://t'), pid(id))).json()).ok).toBeFalsy(); // gone
  });

  it('any team member can comment (not gated by authorship); comments are author-deletable', async () => {
    const author = await seedUser();
    const mate = await seedUser();
    const team = await seedTeam(author, [author, mate]);
    as(author);
    const id = (await (await listPost(jreq({ ownLeader: 'Cad Bane', ownBase: 'asp:cunning', oppLeader: 'Ahsoka', oppBase: 'asp:command' }), p(team))).json()).data.id;

    // the NON-author teammate comments
    as(mate);
    const c = await (await commentPost(jreq({ body: 'I keep 1 Devastator vs ramp' }), pid(id))).json();
    expect(c.ok).toBe(true);
    const got = await (await oneGet(new Request('http://t'), pid(id))).json();
    expect(got.data.comments.map((x: any) => x.body)).toContain('I keep 1 Devastator vs ramp');

    const delReq = (commentId: string) => ({ params: Promise.resolve({ commentId }) });
    // the guide author cannot delete the teammate's comment; the poster can
    as(author);
    expect((await (await commentDel(new Request('http://t', { method: 'DELETE' }), delReq(c.data.id))).json()).ok).toBeFalsy();
    as(mate);
    expect((await (await commentDel(new Request('http://t', { method: 'DELETE' }), delReq(c.data.id))).json()).ok).toBe(true);

    // a non-member cannot comment
    as(await seedUser());
    expect((await (await commentPost(jreq({ body: 'x' }), pid(id))).json()).ok).toBeFalsy();
  });

  it('rejects a create with an incomplete matchup', async () => {
    const owner = await seedUser();
    const team = await seedTeam(owner, [owner]);
    as(owner);
    const bad = await (await listPost(jreq({ ownLeader: 'Cad Bane', notes: 'x' }), p(team))).json();
    expect(bad.ok).toBeFalsy();
  });
});
