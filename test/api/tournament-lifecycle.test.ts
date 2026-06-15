import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, replays } from '@/lib/schema';
import { POST as createTournament } from '@/app/api/teams/[slug]/tournaments/route';
import { GET as getDetail } from '@/app/api/teams/[slug]/tournaments/[id]/route';
import { POST as addEntrant, } from '@/app/api/teams/[slug]/tournaments/[id]/entrants/route';
import { POST as startTournament } from '@/app/api/teams/[slug]/tournaments/[id]/start/route';
import { POST as nextRound } from '@/app/api/teams/[slug]/tournaments/[id]/rounds/route';
import { POST as finishTournament } from '@/app/api/teams/[slug]/tournaments/[id]/finish/route';
import { POST as reportMatch } from '@/app/api/teams/[slug]/tournaments/[id]/matches/[matchId]/report/route';
import { POST as confirmMatch } from '@/app/api/teams/[slug]/tournaments/[id]/matches/[matchId]/confirm/route';

// B124/P3: the full manual lifecycle — start, report (player vs organizer),
// confirm/lock, next-round pairing, finish — incl. guest entrants.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const as = (id: string | null) => vi.mocked(auth).mockResolvedValue(id ? ({ user: { id } } as any) : (null as any));

async function seedUser(name = 'u') {
  const id = randomUUID();
  await getDb().insert(users).values({ id, name: `${name}-${id.slice(0, 4)}`, email: `${id}@e.com` });
  return id;
}
async function seedTeam(members: string[]) {
  const slug = randomUUID().slice(0, 6);
  await getDb().insert(teams).values({ slug, name: slug, createdBy: members[0] });
  await getDb().insert(teamMembers).values(
    members.map((u, i) => ({ teamSlug: slug, userId: u, role: i === 0 ? 'owner' : 'member' }))
  );
  return slug;
}
const p = (slug: string, rest: Record<string, string> = {}) => ({ params: Promise.resolve({ slug, ...rest }) as any });
const jreq = (body: unknown) => new Request('http://t/x', { method: 'POST', body: JSON.stringify(body) });
const noBody = () => new Request('http://t/x', { method: 'POST' });

const detail = async (slug: string, id: string) =>
  (await (await getDetail(new Request('http://t'), p(slug, { id }))).json()).data;

// owner + 2 members + 1 guest = 4 entrants. Returns ids + entrant ids by user.
async function seedStartedTournament() {
  const owner = await seedUser('owner');
  const m1 = await seedUser('m1');
  const m2 = await seedUser('m2');
  const slug = await seedTeam([owner, m1, m2]);
  as(owner);
  const id = (await (await createTournament(jreq({ name: 'Cup' }), p(slug))).json()).id as string;
  const ownerEntrant = (await (await addEntrant(jreq({}), p(slug, { id }))).json()).entrantId as string;
  const guestEntrant = (await (await addEntrant(jreq({ displayName: 'Guest Gus' }), p(slug, { id }))).json()).entrantId as string;
  as(m1);
  const m1Entrant = (await (await addEntrant(jreq({}), p(slug, { id }))).json()).entrantId as string;
  as(m2);
  const m2Entrant = (await (await addEntrant(jreq({}), p(slug, { id }))).json()).entrantId as string;
  as(owner);
  const startRes = await startTournament(noBody(), p(slug, { id }));
  expect((await startRes.json()).ok).toBe(true);
  return { owner, m1, m2, slug, id, entrants: { owner: ownerEntrant, guest: guestEntrant, m1: m1Entrant, m2: m2Entrant } };
}

beforeEach(() => vi.mocked(auth).mockReset());

describe('start', () => {
  it('needs organizer, ≥2 entrants, and setup status; pairs round 1 (even field: no bye)', async () => {
    const { slug, id, owner } = await seedStartedTournament();
    as(owner);
    const d = await detail(slug, id);
    expect(d.tournament.status).toBe('active');
    expect(d.rounds).toHaveLength(1);
    expect(d.rounds[0].matches).toHaveLength(2); // 4 entrants → 2 pairings
    expect(d.rounds[0].matches.every((m: any) => m.entrant2Id !== null)).toBe(true);

    // Already started → 409; registration closed → 409.
    expect((await startTournament(noBody(), p(slug, { id }))).status).toBe(409);
    expect((await addEntrant(jreq({ displayName: 'Late Guest' }), p(slug, { id }))).status).toBe(409);
  });

  it('refuses with <2 entrants and for non-organizers', async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const slug = await seedTeam([owner, member]);
    as(owner);
    const id = (await (await createTournament(jreq({ name: 'Tiny' }), p(slug))).json()).id as string;
    expect((await startTournament(noBody(), p(slug, { id }))).status).toBe(409); // 0 entrants
    await addEntrant(jreq({}), p(slug, { id }));
    as(member);
    expect((await startTournament(noBody(), p(slug, { id }))).status).toBe(403);
  });

  it('odd field gets a pre-confirmed 2-0 bye', async () => {
    const owner = await seedUser();
    const slug = await seedTeam([owner]);
    as(owner);
    const id = (await (await createTournament(jreq({ name: 'Odd' }), p(slug))).json()).id as string;
    await addEntrant(jreq({}), p(slug, { id }));
    await addEntrant(jreq({ displayName: 'G1' }), p(slug, { id }));
    await addEntrant(jreq({ displayName: 'G2' }), p(slug, { id }));
    await startTournament(noBody(), p(slug, { id }));
    const d = await detail(slug, id);
    const bye = d.rounds[0].matches.find((m: any) => m.entrant2Id === null);
    expect(bye).toBeTruthy();
    expect(bye.status).toBe('confirmed');
    expect(bye.games).toHaveLength(2);
    const byeStanding = d.standings.find((s: any) => s.entrantId === bye.entrant1Id);
    expect(byeStanding.points).toBe(3);
  });
});

describe('reporting', () => {
  it('paired player reports (status reported); organizer confirm locks it', async () => {
    const { slug, id, owner, m1, entrants } = await seedStartedTournament();
    as(owner);
    let d = await detail(slug, id);
    const match = d.rounds[0].matches.find((m: any) => [m.entrant1Id, m.entrant2Id].includes(entrants.m1));

    as(m1);
    const games = [{ winner: entrants.m1 }, { winner: entrants.m1 }];
    const rep = await reportMatch(jreq({ games }), p(slug, { id, matchId: match.id }));
    expect((await rep.json()).status).toBe('reported');

    as(owner);
    expect((await confirmMatch(noBody(), p(slug, { id, matchId: match.id }))).status).toBe(200);
    d = await detail(slug, id);
    const after = d.rounds[0].matches.find((m: any) => m.id === match.id);
    expect(after.status).toBe('confirmed');

    // Player can no longer change a confirmed result; organizer can.
    as(m1);
    expect((await reportMatch(jreq({ games }), p(slug, { id, matchId: match.id }))).status).toBe(409);
    as(owner);
    const override = await reportMatch(jreq({ games: [{ winner: match.entrant1Id }, { winner: match.entrant1Id }] }), p(slug, { id, matchId: match.id }));
    expect((await override.json()).status).toBe('confirmed'); // organizer report lands confirmed
  });

  it('uninvolved member cannot report; invalid winner / empty games are 400', async () => {
    const { slug, id, owner, m1, m2, entrants } = await seedStartedTournament();
    as(owner);
    const d = await detail(slug, id);
    // The owner's match: the owner occupies one slot, so exactly one of
    // {guest, m1, m2} is the opponent — at least one of m1/m2 is uninvolved.
    const ownerMatch = d.rounds[0].matches.find((m: any) => [m.entrant1Id, m.entrant2Id].includes(entrants.owner));
    const inMatch = (e: string) => [ownerMatch.entrant1Id, ownerMatch.entrant2Id].includes(e);
    const uninvolvedUser = inMatch(entrants.m1) ? m2 : m1;

    as(uninvolvedUser);
    const res = await reportMatch(jreq({ games: [{ winner: ownerMatch.entrant1Id }] }), p(slug, { id, matchId: ownerMatch.id }));
    expect(res.status).toBe(403);

    as(owner);
    expect((await reportMatch(jreq({ games: [{ winner: 'te_bogus' }] }), p(slug, { id, matchId: ownerMatch.id }))).status).toBe(400);
    expect((await reportMatch(jreq({ games: [] }), p(slug, { id, matchId: ownerMatch.id }))).status).toBe(400);
  });
});

describe('rounds + finish', () => {
  async function reportAll(slug: string, id: string, ownerId: string) {
    as(ownerId);
    const d = await detail(slug, id);
    const current = d.rounds[d.rounds.length - 1];
    for (const m of current.matches) {
      if (m.entrant2Id === null || m.status === 'confirmed') continue;
      await reportMatch(jreq({ games: [{ winner: m.entrant1Id }, { winner: m.entrant1Id }] }), p(slug, { id, matchId: m.id }));
    }
  }

  it('pair-next 409s with pending matches; works once all reported; no rematch in round 2', async () => {
    const { slug, id, owner } = await seedStartedTournament();
    as(owner);
    expect((await nextRound(noBody(), p(slug, { id }))).status).toBe(409); // pending

    await reportAll(slug, id, owner);
    const res = await nextRound(noBody(), p(slug, { id }));
    expect((await res.json()).ok).toBe(true);

    const d = await detail(slug, id);
    expect(d.rounds).toHaveLength(2);
    expect(d.rounds[0].status).toBe('complete');
    // Round 2 never repeats a round-1 pairing.
    const r1Pairs = new Set(
      d.rounds[0].matches.filter((m: any) => m.entrant2Id).map((m: any) => [m.entrant1Id, m.entrant2Id].sort().join('|'))
    );
    for (const m of d.rounds[1].matches) {
      if (!m.entrant2Id) continue;
      expect(r1Pairs.has([m.entrant1Id, m.entrant2Id].sort().join('|'))).toBe(false);
    }
  });

  it('finish completes the tournament (current round must be fully reported)', async () => {
    const { slug, id, owner } = await seedStartedTournament();
    as(owner);
    expect((await finishTournament(noBody(), p(slug, { id }))).status).toBe(409); // pending matches
    await reportAll(slug, id, owner);
    expect((await finishTournament(noBody(), p(slug, { id }))).status).toBe(200);
    const d = await detail(slug, id);
    expect(d.tournament.status).toBe('complete');
    expect(d.rounds[0].status).toBe('complete');
    // Standings have a clear leader with 3+ points.
    expect(d.standings[0].points).toBeGreaterThanOrEqual(3);
    // Everything is locked now.
    expect((await nextRound(noBody(), p(slug, { id }))).status).toBe(409);
  });

  it('replay-derived suggestions appear for linked pairings and confirm via report', async () => {
    const { slug, id, owner, entrants } = await seedStartedTournament();
    as(owner);
    let d = await detail(slug, id);
    // Find a linked-vs-linked pending match (owner/m1/m2 are linked; guest is not).
    const linked = new Set([entrants.owner, entrants.m1, entrants.m2]);
    const match = d.rounds[0].matches.find(
      (m: any) => m.entrant2Id && linked.has(m.entrant1Id) && linked.has(m.entrant2Id)
    );
    expect(match).toBeTruthy();
    expect(d.suggestions[match.id]).toBeUndefined(); // no replays yet

    // entrantId → account: the detail payload carries each entrant's userId.
    const userByEntrant: Record<string, string> = Object.fromEntries(
      d.entrants.map((e: any) => [e.id, e.userId])
    );

    // Insert two replays uploaded by entrant1's account: win then loss → 1-1.
    const lobby = 'lobby-' + randomUUID().slice(0, 6);
    for (const [i, winSide] of [['a', 'p1'], ['b', 'p2']] as const) {
      await getDb().insert(replays).values({
        slug: `r_sugg${randomUUID().slice(0, 4)}${i}`,
        gameId: randomUUID(),
        userId: userByEntrant[match.entrant1Id],
        ownerToken: 'kbx_test',
        players: [{ id: 'p1', username: 'A' }, { id: 'p2', username: 'B' }],
        payloadBlobUrl: 'https://blob.test/x.json',
        ownerPlayerId: 'p1',
        winners: [winSide],
        match: { lobbyId: lobby },
      });
    }

    d = await detail(slug, id);
    const suggestion = d.suggestions[match.id];
    expect(suggestion).toBeTruthy();
    expect(suggestion.score).toBe('1-1');
    expect(suggestion.games).toHaveLength(2);
    expect(suggestion.games[0].replaySlug).toMatch(/^r_sugg/);

    // Confirm the suggestion through the normal report endpoint.
    const rep = await reportMatch(jreq({ games: suggestion.games, source: 'replays' }), p(slug, { id, matchId: match.id }));
    expect((await rep.json()).ok).toBe(true);
    d = await detail(slug, id);
    const after = d.rounds[0].matches.find((m: any) => m.id === match.id);
    expect(after.resultSource).toBe('replays');
    expect(d.suggestions[match.id]).toBeUndefined(); // no longer pending
  });

  it('hidden-until-start decks flip to team-visible once round 1 exists; self decklist edits lock', async () => {
    const owner = await seedUser('owner');
    const m1 = await seedUser('m1');
    const slug = await seedTeam([owner, m1]);
    as(owner);
    const { POST: createT } = await import('@/app/api/teams/[slug]/tournaments/route');
    const { PATCH: patchEntrant } = await import('@/app/api/teams/[slug]/tournaments/[id]/entrants/[entrantId]/route');
    const id = (await (await createT(jreq({ name: 'Flip', decklistVisibility: 'hidden-until-start' }), p(slug))).json()).id as string;

    // m1 registers WITH a deck (stub the upstream site).
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      metadata: { name: 'Hidden Deck' },
      leader: { id: 'SOR_010', count: 1 }, base: { id: 'SOR_030', count: 1 },
      deck: Array.from({ length: 50 }, (_, i) => ({ id: `SOR_${100 + i}`, count: 1 })), sideboard: [], // B152: legal ≥50
    }), { status: 200 })));
    as(m1);
    const m1Entrant = (await (await addEntrant(jreq({ deckLink: 'https://swubase.com/decks/x' }), p(slug, { id }))).json()).entrantId as string;
    as(owner);
    await addEntrant(jreq({}), p(slug, { id }));
    vi.unstubAllGlobals();

    // Pre-start: the OWNER is the organizer so sees it — but check as a third
    // member... here owner IS organizer; assert m1's deck hidden from a plain
    // member by adding one.
    const m2 = await seedUser('m2');
    await getDb().insert(teamMembers).values({ teamSlug: slug, userId: m2, role: 'member' });
    as(m2);
    let d = await detail(slug, id);
    expect(d.entrants.find((e: any) => e.id === m1Entrant).deck).toBeNull();

    as(owner);
    await startTournament(noBody(), p(slug, { id }));

    // Post-start: the same member now sees it.
    as(m2);
    d = await detail(slug, id);
    expect(d.entrants.find((e: any) => e.id === m1Entrant).deck).not.toBeNull();

    // Post-start: m1 can no longer change their own deck; the organizer can.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      metadata: { name: 'Late Swap' },
      leader: { id: 'SOR_011', count: 1 }, base: { id: 'SOR_031', count: 1 },
      deck: Array.from({ length: 50 }, (_, i) => ({ id: `SOR_${200 + i}`, count: 1 })), sideboard: [], // B152: legal ≥50
    }), { status: 200 })));
    as(m1);
    expect((await patchEntrant(jreq({ deckLink: 'https://swubase.com/decks/y' }), p(slug, { id, entrantId: m1Entrant }))).status).toBe(403);
    as(owner);
    expect((await patchEntrant(jreq({ deckLink: 'https://swubase.com/decks/y' }), p(slug, { id, entrantId: m1Entrant }))).status).toBe(200);
    vi.unstubAllGlobals();
  });

  it('a dropped entrant is excluded from the next round pairing', async () => {
    const { slug, id, owner, entrants } = await seedStartedTournament();
    const { PATCH: patchEntrant } = await import('@/app/api/teams/[slug]/tournaments/[id]/entrants/[entrantId]/route');
    await reportAll(slug, id, owner);
    as(owner);
    expect((await patchEntrant(jreq({ dropped: true }), p(slug, { id, entrantId: entrants.guest }))).status).toBe(200);
    await nextRound(noBody(), p(slug, { id }));
    const d = await detail(slug, id);
    const r2 = d.rounds[1];
    const r2Entrants = r2.matches.flatMap((m: any) => [m.entrant1Id, m.entrant2Id]).filter(Boolean);
    expect(r2Entrants).not.toContain(entrants.guest);
    // 3 remaining actives → 1 pairing + 1 bye.
    expect(r2.matches).toHaveLength(2);
    // The dropped guest keeps their standings row, flagged.
    expect(d.standings.find((s: any) => s.entrantId === entrants.guest).dropped).toBe(true);
  });

  it('guest matches are organizer-reported and count in standings', async () => {
    const { slug, id, owner, entrants } = await seedStartedTournament();
    as(owner);
    let d = await detail(slug, id);
    const guestMatch = d.rounds[0].matches.find((m: any) => [m.entrant1Id, m.entrant2Id].includes(entrants.guest));
    expect(guestMatch).toBeTruthy();
    const rep = await reportMatch(
      jreq({ games: [{ winner: entrants.guest }, { winner: entrants.guest }] }),
      p(slug, { id, matchId: guestMatch.id })
    );
    expect((await rep.json()).status).toBe('confirmed');
    d = await detail(slug, id);
    const guestStanding = d.standings.find((s: any) => s.entrantId === entrants.guest);
    expect(guestStanding.points).toBe(3);
    expect(guestStanding.wins).toBe(1);
  });
});
