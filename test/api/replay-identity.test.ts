import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { GET } from '@/app/api/replays/[slug]/route';
import { canViewReplayIdentities } from '@/lib/altPerspective';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, replays } from '@/lib/schema';

// B122: karabast usernames + full deck lists + the title are visible ONLY to the
// uploader or a teammate of the uploader. Everyone else gets anonymized players,
// no decklists, the anon title, no tags.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const as = (id: string | null) => vi.mocked(auth).mockResolvedValue(id ? ({ user: { id } } as any) : (null as any));

async function seedUser() {
  const id = randomUUID();
  await getDb().insert(users).values({ id, name: id.slice(0, 4), email: `${id}@e.com` });
  return id;
}
async function seedTeam(members: string[]) {
  const slug = randomUUID().slice(0, 6);
  await getDb().insert(teams).values({ slug, name: slug, createdBy: members[0] });
  await getDb().insert(teamMembers).values(members.map((u) => ({ teamSlug: slug, userId: u, role: u === members[0] ? 'owner' : 'member' })));
  return slug;
}
async function seedReplay(userId: string, ownerToken: string) {
  const slug = 'r_' + randomUUID().slice(0, 6);
  await getDb().insert(replays).values({
    slug, gameId: randomUUID(), userId, ownerToken,
    ownerPlayerId: 'p1',
    players: [
      { id: 'p1', username: 'RealAlice', leader: { name: 'Luke', set: 'SOR', number: 1 }, base: { name: 'Base', set: 'SOR', number: 2 } },
      { id: 'p2', username: 'RealBob', leader: { name: 'Thrawn', set: 'SOR', number: 3 }, base: { name: 'Base2', set: 'SOR', number: 4 } },
    ],
    decks: { p1: { username: 'RealAlice', name: "Alice's Deck", deck: [{ id: 'SOR_005', count: 3 }] }, p2: { username: 'RealBob', deck: null } },
    payloadBlobUrl: `https://blob.test/${slug}.json`,
  });
  return slug;
}
const getJson = (slug: string) => GET(new Request(`http://t/api/replays/${slug}`), { params: Promise.resolve({ slug }) }).then((r) => r.json());

beforeEach(() => vi.mocked(auth).mockReset());

describe('B122 GET /api/replays/[slug] identity gating', () => {
  it('shows real usernames + decks to the uploader', async () => {
    const a = await seedUser();
    const slug = await seedReplay(a, 'kbx_a');
    as(a);
    const { data } = await getJson(slug);
    expect(data.players.map((p: any) => p.username)).toEqual(['RealAlice', 'RealBob']);
    expect(data.decks.p1.deck).toHaveLength(1);
  });

  it('shows real usernames + decks to a teammate of the uploader', async () => {
    const a = await seedUser(); const b = await seedUser();
    await seedTeam([a, b]);
    const slug = await seedReplay(a, 'kbx_a');
    as(b);
    const { data } = await getJson(slug);
    expect(data.players[0].username).toBe('RealAlice');
    expect(data.decks.p1.deck).toHaveLength(1);
  });

  it('anonymizes for a stranger: Player labels, no decks, no handle in title fields', async () => {
    const a = await seedUser(); const stranger = await seedUser();
    await seedTeam([stranger]); // their own unrelated team
    const slug = await seedReplay(a, 'kbx_a');
    as(stranger);
    const { data } = await getJson(slug);
    expect(data.players.map((p: any) => p.username)).toEqual(['Player1', 'Player2']);
    expect(data.decks).toBeNull();
    expect(data.displayName).toBeNull();
    expect(data.tags).toEqual([]);
    expect(data.userId).toBeNull();
    expect(data.ownerToken).toBe('');
    // leaders are kept (public — shown on the board) so the matchup still reads.
    expect(data.players[0].leader.name).toBe('Luke');
  });

  it('anonymizes for an anonymous (signed-out) visitor', async () => {
    const a = await seedUser();
    const slug = await seedReplay(a, 'kbx_a');
    as(null);
    const { data } = await getJson(slug);
    expect(data.players[0].username).toBe('Player1');
    expect(data.decks).toBeNull();
  });
});

describe('canViewReplayIdentities', () => {
  it('owner by account, owner by install token, teammate; stranger + anon → false', async () => {
    const a = await seedUser(); const b = await seedUser(); const c = await seedUser();
    await seedTeam([a, b]);
    const replay = { userId: a, ownerToken: 'kbx_owner' };
    expect(await canViewReplayIdentities(replay, { sessionUserId: a, installToken: null })).toBe(true);  // owner (account)
    expect(await canViewReplayIdentities(replay, { sessionUserId: null, installToken: 'kbx_owner' })).toBe(true); // owner (token)
    expect(await canViewReplayIdentities(replay, { sessionUserId: b, installToken: null })).toBe(true);  // teammate
    expect(await canViewReplayIdentities(replay, { sessionUserId: c, installToken: null })).toBe(false); // stranger
    expect(await canViewReplayIdentities(replay, { sessionUserId: null, installToken: null })).toBe(false); // anon
  });
});
