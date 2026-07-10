import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { GET as poolGet } from '@/app/api/teams/[slug]/sideboarding/route';
import { GET as itemGet, POST as itemPost } from '@/app/api/replays/[slug]/sideboard/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, replays, replayTeamShares, replaySideboards } from '@/lib/schema';

// B227: the sideboard drill pool + item — anonymity (no recorded swap until you
// answer), response validation (in⊆sideboard / out⊆deck), immutability.

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
const card = (id: string, count = 1) => ({ id, count });
// A recorded game-N+1 with a sideboard fact, shared to a team.
async function seedSideboard(opts: { owner: string; team: string; swappedIn: string[]; swappedOut: string[] }) {
  const slug = randomUUID().slice(0, 8);
  const prev = randomUUID().slice(0, 8);
  await getDb().insert(replays).values({
    slug, gameId: randomUUID(), ownerToken: `kbx_${randomUUID()}`, userId: opts.owner,
    players: [{ id: 'P', leader: { name: 'Boba', set: 'SOR', number: 5 } }, { id: 'Q', leader: { name: 'Leia', set: 'SOR', number: 8 } }],
    payloadBlobUrl: 'blob://x', ownerPlayerId: 'P', match: { gameFormat: 'premier', lobbyId: randomUUID() },
  });
  await getDb().insert(replaySideboards).values({
    replaySlug: slug, previousSlug: prev, recorderId: 'P', lobbyId: randomUUID(), gameNumber: 2,
    deck: [card('A', 3), card('B', 3), card('C', 2)], sideboard: [card('X', 3), card('Y', 2)],
    swappedIn: opts.swappedIn, swappedOut: opts.swappedOut, wonPrevious: false, extractorVersion: 1,
  });
  await getDb().insert(replayTeamShares).values({ replaySlug: slug, teamSlug: opts.team, sharedBy: opts.owner });
  return slug;
}
const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
const pool = async (team: string) => (await (await poolGet(new Request('http://t'), params(team))).json()).data as any[];
const item = async (slug: string) => (await itemGet(new Request('http://t'), params(slug))).json();
const answer = async (slug: string, body: any) => (await itemPost(new Request('http://t', { method: 'POST', body: JSON.stringify(body) }), params(slug))).json();

beforeEach(() => vi.mocked(auth).mockReset());

describe('sideboard drills', () => {
  it('hides the recorded swap until the viewer answers', async () => {
    const owner = await seedUser();
    const mate = await seedUser();
    const team = await seedTeam(owner, [owner, mate]);
    const slug = await seedSideboard({ owner, team, swappedIn: ['X'], swappedOut: ['A'] });

    as(mate);
    // pool: unanswered → no recorded swap leaked
    const before = (await pool(team)).find((i) => i.replaySlug === slug);
    expect(before.answered).toBe(false);
    expect(before.recordedSwappedIn).toBeUndefined();
    // item detail: quiz data present, reveal absent
    const d1 = (await item(slug)).data;
    expect(d1.deck).toHaveLength(3);
    expect(d1.sideboard).toHaveLength(2);
    expect(d1.reveal).toBeUndefined();

    // answer → reveal appears with the recorder's swap
    const d2 = (await answer(slug, { swappedIn: ['X'], swappedOut: ['B'] })).data;
    expect(d2.reveal.swappedIn).toEqual(['X']);
    expect(d2.reveal.swappedOut).toEqual(['A']);
    expect(d2.myResponse.swappedOut).toEqual(['B']);
  });

  it('validates in⊆sideboard, out⊆deck; is immutable + owner can\'t answer own', async () => {
    const owner = await seedUser();
    const mate = await seedUser();
    const team = await seedTeam(owner, [owner, mate]);
    const slug = await seedSideboard({ owner, team, swappedIn: ['X'], swappedOut: ['A'] });

    as(mate);
    expect((await answer(slug, { swappedIn: ['NOTINSB'], swappedOut: [] })).error).toMatch(/sideboard/);
    expect((await answer(slug, { swappedIn: [], swappedOut: ['NOTINDECK'] })).error).toMatch(/deck/);
    // valid answer, then a conflicting re-answer is a no-op (first counts)
    await answer(slug, { swappedIn: ['X'], swappedOut: ['A'] });
    const re = (await answer(slug, { swappedIn: ['Y'], swappedOut: ['C'] })).data;
    expect(re.myResponse.swappedIn).toEqual(['X']); // unchanged

    // the owner cannot answer their own sideboard
    as(owner);
    expect((await answer(slug, { swappedIn: ['X'], swappedOut: ['A'] })).error).toMatch(/own/);
  });

  it('pool is member-only', async () => {
    const owner = await seedUser();
    const team = await seedTeam(owner, [owner]);
    await seedSideboard({ owner, team, swappedIn: [], swappedOut: [] });
    const outsider = await seedUser();
    as(outsider);
    expect((await (await poolGet(new Request('http://t'), params(team))).json()).ok).toBeFalsy();
  });
});
