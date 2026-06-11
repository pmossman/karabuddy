import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers } from '@/lib/schema';
import { GET as listTournaments, POST as createTournament } from '@/app/api/teams/[slug]/tournaments/route';
import { GET as getDetail, PATCH as patchTournament, DELETE as deleteTournament } from '@/app/api/teams/[slug]/tournaments/[id]/route';
import { POST as addEntrant } from '@/app/api/teams/[slug]/tournaments/[id]/entrants/route';
import { PATCH as patchEntrant, DELETE as deleteEntrant } from '@/app/api/teams/[slug]/tournaments/[id]/entrants/[entrantId]/route';
import { GET as swudbdeck } from '@/app/api/swudbdeck/route';

// B124/P2: tournament + entrant CRUD, deck import, decklist visibility.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const as = (id: string | null) => vi.mocked(auth).mockResolvedValue(id ? ({ user: { id } } as any) : (null as any));

async function seedUser(name = 'u') {
  const id = randomUUID();
  await getDb().insert(users).values({ id, name: `${name}-${id.slice(0, 4)}`, email: `${id}@e.com` });
  return id;
}
async function seedTeam(members: string[], ownerCount = 1) {
  const slug = randomUUID().slice(0, 6);
  await getDb().insert(teams).values({ slug, name: slug, createdBy: members[0] });
  await getDb().insert(teamMembers).values(
    members.map((u, i) => ({ teamSlug: slug, userId: u, role: i < ownerCount ? 'owner' : 'member' }))
  );
  return slug;
}

const p = (slug: string, rest: Record<string, string> = {}) => ({ params: Promise.resolve({ slug, ...rest }) as any });
const jreq = (body: unknown) => new Request('http://t/x', { method: 'POST', body: JSON.stringify(body) });

async function createT(slug: string, body: Record<string, unknown> = {}) {
  const res = await createTournament(jreq({ name: 'Weekly', ...body }), p(slug));
  const json = await res.json();
  expect(json.ok).toBe(true);
  return json.id as string;
}

// A valid IDeckData payload as the deck sites return it.
const upstreamDeck = {
  metadata: { name: 'Test Deck' },
  leader: { id: 'SOR_010', count: 1 },
  secondleader: null,
  base: { id: 'SOR_030', count: 1 },
  deck: [{ id: 'SOR_100', count: 3 }, { id: 'JTL_045', count: 2 }],
  sideboard: [{ id: 'SOR_200', count: 1 }],
};
const stubFetch = (status = 200, body: unknown = upstreamDeck) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));

beforeEach(() => vi.mocked(auth).mockReset());
afterEach(() => vi.unstubAllGlobals());

describe('tournament CRUD', () => {
  it('member can create + list; non-member is 403', async () => {
    const owner = await seedUser('owner');
    const stranger = await seedUser('stranger');
    const slug = await seedTeam([owner]);

    as(owner);
    const id = await createT(slug, { decklistVisibility: 'open', plannedRounds: 3 });
    const list = await (await listTournaments(new Request('http://t'), p(slug))).json();
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({ id, name: 'Weekly', status: 'setup', decklistVisibility: 'open', plannedRounds: 3, entrantCount: 0 });

    as(stranger);
    expect((await listTournaments(new Request('http://t'), p(slug))).status).toBe(403);
    expect((await createTournament(jreq({ name: 'x' }), p(slug))).status).toBe(403);
  });

  it('rejects bad create inputs', async () => {
    const owner = await seedUser();
    const slug = await seedTeam([owner]);
    as(owner);
    expect((await createTournament(jreq({ name: '' }), p(slug))).status).toBe(400);
    expect((await createTournament(jreq({ name: 'x', decklistVisibility: 'nope' }), p(slug))).status).toBe(400);
    expect((await createTournament(jreq({ name: 'x', plannedRounds: 0 }), p(slug))).status).toBe(400);
  });

  it('organizer = creator or team owner; member-creator can edit, other member cannot', async () => {
    const owner = await seedUser('owner');
    const creator = await seedUser('creator');
    const other = await seedUser('other');
    const slug = await seedTeam([owner, creator, other]); // only first is owner

    as(creator);
    const id = await createT(slug);

    // Creator (plain member) can PATCH.
    expect((await patchTournament(jreq({ name: 'Renamed' }), p(slug, { id }))).status).toBe(200);
    // Team owner (not creator) can PATCH.
    as(owner);
    expect((await patchTournament(jreq({ decklistVisibility: 'private' }), p(slug, { id }))).status).toBe(200);
    // Unrelated member cannot.
    as(other);
    expect((await patchTournament(jreq({ name: 'nope' }), p(slug, { id }))).status).toBe(403);
  });

  it('delete is organizer-only and setup-only', async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const slug = await seedTeam([owner, member]);
    as(owner);
    const id = await createT(slug);
    as(member);
    expect((await deleteTournament(new Request('http://t'), p(slug, { id }))).status).toBe(403);
    as(owner);
    expect((await deleteTournament(new Request('http://t'), p(slug, { id }))).status).toBe(200);
    expect((await getDetail(new Request('http://t'), p(slug, { id }))).status).toBe(404);
  });
});

describe('entrants', () => {
  it('self-register, duplicate 409, unregister', async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const slug = await seedTeam([owner, member]);
    as(owner);
    const id = await createT(slug);

    as(member);
    const reg = await (await addEntrant(jreq({}), p(slug, { id }))).json();
    expect(reg.ok).toBe(true);
    expect((await addEntrant(jreq({}), p(slug, { id }))).status).toBe(409); // dup

    const detail = await (await getDetail(new Request('http://t'), p(slug, { id }))).json();
    expect(detail.data.entrants).toHaveLength(1);
    expect(detail.data.viewer.entrantId).toBe(reg.entrantId);

    expect((await deleteEntrant(new Request('http://t'), p(slug, { id, entrantId: reg.entrantId }))).status).toBe(200);
  });

  it('guest-add is organizer-only; guests can be renamed, linked entrants cannot', async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const slug = await seedTeam([owner, member]);
    as(owner);
    const id = await createT(slug);

    as(member);
    expect((await addEntrant(jreq({ displayName: 'Guest Greg' }), p(slug, { id }))).status).toBe(403);

    as(owner);
    const guest = await (await addEntrant(jreq({ displayName: 'Guest Greg' }), p(slug, { id }))).json();
    expect(guest.ok).toBe(true);
    // Organizer can add multiple guests (the unique index only binds accounts).
    expect((await addEntrant(jreq({ displayName: 'Guest Gina' }), p(slug, { id }))).json()).resolves.toMatchObject({ ok: true });

    expect((await patchEntrant(jreq({ displayName: 'Greg Renamed' }), p(slug, { id, entrantId: guest.entrantId }))).status).toBe(200);

    as(member);
    const self = await (await addEntrant(jreq({}), p(slug, { id }))).json();
    as(owner);
    expect((await patchEntrant(jreq({ displayName: 'No' }), p(slug, { id, entrantId: self.entrantId }))).status).toBe(400);
  });

  it('registers with a deck link — imported + snapshotted', async () => {
    const owner = await seedUser();
    const slug = await seedTeam([owner]);
    as(owner);
    const id = await createT(slug, { decklistVisibility: 'open' });

    stubFetch();
    const reg = await (await addEntrant(jreq({ deckLink: 'https://swubase.com/decks/abc123' }), p(slug, { id }))).json();
    expect(reg.ok).toBe(true);

    const detail = await (await getDetail(new Request('http://t'), p(slug, { id }))).json();
    const entrant = detail.data.entrants[0];
    expect(entrant.deckName).toBe('Test Deck');
    expect(entrant.deck.leader.id).toBe('SOR_010');
    expect(entrant.deck.deck).toHaveLength(2);
    expect(entrant.hasDeck).toBe(true);
  });

  it('broken deck link fails the request without registering', async () => {
    const owner = await seedUser();
    const slug = await seedTeam([owner]);
    as(owner);
    const id = await createT(slug);

    stubFetch(404, { error: 'nope' });
    const res = await addEntrant(jreq({ deckLink: 'https://swubase.com/decks/abc123' }), p(slug, { id }));
    expect(res.status).toBe(403); // swubase private-deck mapping
    const detail = await (await getDetail(new Request('http://t'), p(slug, { id }))).json();
    expect(detail.data.entrants).toHaveLength(0);
  });

  it('rejects malformed upstream payloads (validation karabast lacks)', async () => {
    const owner = await seedUser();
    const slug = await seedTeam([owner]);
    as(owner);
    const id = await createT(slug);

    stubFetch(200, { ...upstreamDeck, deck: [{ id: 'DROP TABLE;--', count: 3 }] });
    const res = await addEntrant(jreq({ deckLink: 'https://swubase.com/decks/abc123' }), p(slug, { id }));
    expect(res.status).toBe(422);
  });
});

describe('decklist visibility', () => {
  async function setup(visibility: string) {
    const owner = await seedUser('owner');
    const member = await seedUser('member');
    const viewer = await seedUser('viewer');
    const slug = await seedTeam([owner, member, viewer]);
    as(owner);
    const id = await createT(slug, { decklistVisibility: visibility });
    stubFetch();
    as(member);
    await addEntrant(jreq({ deckLink: 'https://swubase.com/decks/abc123' }), p(slug, { id }));
    return { owner, member, viewer, slug, id };
  }
  const entrantSeenBy = async (slug: string, id: string) => {
    const detail = await (await getDetail(new Request('http://t'), p(slug, { id }))).json();
    return detail.data.entrants[0];
  };

  it("open: any member sees the deck", async () => {
    const { viewer, slug, id } = await setup('open');
    as(viewer);
    const e = await entrantSeenBy(slug, id);
    expect(e.deck).not.toBeNull();
    expect(e.deckVisible).toBe(true);
  });

  it('hidden-until-start: hidden from members pre-start; self + organizer always see it', async () => {
    const { owner, member, viewer, slug, id } = await setup('hidden-until-start');
    as(viewer);
    let e = await entrantSeenBy(slug, id);
    expect(e.deck).toBeNull();
    expect(e.deckName).toBeNull(); // name leaks the archetype — hidden too
    expect(e.hasDeck).toBe(true); // but "has registered a deck" is visible
    as(member);
    e = await entrantSeenBy(slug, id);
    expect(e.deck).not.toBeNull(); // own list
    as(owner);
    e = await entrantSeenBy(slug, id);
    expect(e.deck).not.toBeNull(); // organizer
  });

  it('private: hidden from members regardless; organizer sees it', async () => {
    const { owner, viewer, slug, id } = await setup('private');
    as(viewer);
    expect((await entrantSeenBy(slug, id)).deck).toBeNull();
    as(owner);
    expect((await entrantSeenBy(slug, id)).deck).not.toBeNull();
  });
});

describe('GET /api/swudbdeck', () => {
  it('requires a session', async () => {
    as(null);
    const res = await swudbdeck(new Request('http://t/api/swudbdeck?deckLink=https://swubase.com/decks/x'));
    expect(res.status).toBe(401);
  });

  it('imports a supported link; unsupported host is 400', async () => {
    const u = await seedUser();
    as(u);
    stubFetch();
    const ok = await swudbdeck(new Request('http://t/api/swudbdeck?deckLink=' + encodeURIComponent('https://swubase.com/decks/abc')));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.leader.id).toBe('SOR_010');
    expect(body.deckSource).toBe('SWUBase');

    const bad = await swudbdeck(new Request('http://t/api/swudbdeck?deckLink=' + encodeURIComponent('https://swudb.com/deck/view/x')));
    expect(bad.status).toBe(400);
  });
});
