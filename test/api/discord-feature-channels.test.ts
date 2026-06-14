import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, replays, replayTeamShares } from '@/lib/schema';

// B144: per-feature Discord channel routing for review + tournament events.
// Discord transport is mocked so we assert WHICH channel each event posts to
// (override ?? main), without real delivery.
vi.mock('@/lib/discord', () => ({
  postToChannel: vi.fn(async () => ({ ok: true })),
  listGuildTextChannels: vi.fn(async () => [{ id: 'main', name: 'general' }, { id: 'rev', name: 'reviews' }, { id: 'tn', name: 'tourneys' }]),
  sendDM: vi.fn(async () => ({ ok: true, skipped: true })),
  discordBotEnabled: () => false,
}));
vi.mock('@/auth', () => ({ auth: vi.fn() }));

const { auth } = await import('@/auth');
const { postToChannel } = vi.mocked(await import('@/lib/discord'));
const { POST: review } = await import('@/app/api/replays/[slug]/review/route');
const discordRoute = await import('@/app/api/teams/[slug]/discord/route');
const { POST: createTournament } = await import('@/app/api/teams/[slug]/tournaments/route');
const { POST: addEntrant } = await import('@/app/api/teams/[slug]/tournaments/[id]/entrants/route');
const { POST: startTournament } = await import('@/app/api/teams/[slug]/tournaments/[id]/start/route');
const { GET: getDetail } = await import('@/app/api/teams/[slug]/tournaments/[id]/route');
const { POST: reportMatch } = await import('@/app/api/teams/[slug]/tournaments/[id]/matches/[matchId]/report/route');

const as = (id: string | null) => vi.mocked(auth).mockResolvedValue(id ? ({ user: { id } } as any) : (null as any));
const p = (slug: string, rest: Record<string, string> = {}) => ({ params: Promise.resolve({ slug, ...rest }) as any });
const jreq = (body: unknown) => new Request('http://t/x', { method: 'POST', body: JSON.stringify(body) });
const noBody = () => new Request('http://t/x', { method: 'POST' });

async function seedUser(name = 'u') {
  const id = randomUUID();
  await getDb().insert(users).values({ id, name: `${name}-${id.slice(0, 4)}`, email: `${id}@e.com` });
  return id;
}
async function seedTeam(members: string[]) {
  const slug = randomUUID().slice(0, 6);
  await getDb().insert(teams).values({ slug, name: slug, createdBy: members[0] });
  await getDb().insert(teamMembers).values(members.map((u, i) => ({ teamSlug: slug, userId: u, role: i === 0 ? 'owner' : 'member' })));
  return slug;
}
async function setChannels(slug: string, ch: { main?: string | null; review?: string | null; tournament?: string | null }) {
  await getDb().update(teams).set({
    discordChannelId: ch.main ?? null,
    discordReviewChannelId: ch.review ?? null,
    discordTournamentChannelId: ch.tournament ?? null,
  }).where(eq(teams.slug, slug));
}
async function seedSharedReplay(owner: string, teamSlug: string) {
  const slug = randomUUID().slice(0, 8);
  await getDb().insert(replays).values({
    slug, gameId: randomUUID(), userId: owner, ownerToken: `kbx_${randomUUID()}`,
    players: [{ id: 'p1', username: 'A', leader: { name: 'Boba' } }, { id: 'p2', username: 'B', leader: { name: 'Cad' } }],
    ownerPlayerId: 'p1', payloadBlobUrl: `https://blob.test/${slug}.json`,
  });
  await getDb().insert(replayTeamShares).values({ replaySlug: slug, teamSlug, sharedBy: owner });
  return slug;
}
const reviewReq = (replaySlug: string, teamSlug: string, requested: boolean) =>
  review(jreq({ teamSlug, requested }), p(replaySlug));
const lastChannel = () => postToChannel.mock.calls.at(-1)?.[0];

beforeEach(() => { vi.mocked(auth).mockReset(); postToChannel.mockClear(); });

describe('review posts route to the review channel (override ?? main)', () => {
  it('uses the review override; falls back to main; no-op when neither set', async () => {
    const owner = await seedUser('owner');
    const team = await seedTeam([owner]);
    const rep = await seedSharedReplay(owner, team);
    as(owner);

    // main only → posts to main
    await setChannels(team, { main: 'main' });
    postToChannel.mockClear();
    expect((await reviewReq(rep, team, true)).status).toBe(200);
    expect(postToChannel).toHaveBeenCalledTimes(1);
    expect(lastChannel()).toBe('main');
    expect(postToChannel.mock.calls.at(-1)?.[1]).toContain('review queue');

    // review override → posts to override
    await setChannels(team, { main: 'main', review: 'rev' });
    postToChannel.mockClear();
    await reviewReq(rep, team, false);
    expect(lastChannel()).toBe('rev');

    // no channels → no post
    await setChannels(team, {});
    postToChannel.mockClear();
    await reviewReq(rep, team, true);
    expect(postToChannel).not.toHaveBeenCalled();
  });
});

describe('tournament posts route to the tournament channel', () => {
  it('created + registration + match-report all post to the tournament override', async () => {
    const owner = await seedUser('owner');
    const m1 = await seedUser('m1');
    const team = await seedTeam([owner, m1]);
    await setChannels(team, { main: 'main', tournament: 'tn' });
    as(owner);

    postToChannel.mockClear();
    const id = (await (await createTournament(jreq({ name: 'Cup' }), p(team))).json()).id as string;
    expect(lastChannel()).toBe('tn');
    expect(postToChannel.mock.calls.at(-1)?.[1]).toContain('New tournament');

    // registrations (owner guest-add + a member self-register) post to tn
    postToChannel.mockClear();
    await addEntrant(jreq({ displayName: 'Gus' }), p(team, { id }));
    expect(lastChannel()).toBe('tn');
    expect(postToChannel.mock.calls.at(-1)?.[1]).toContain('registered');
    as(m1);
    await addEntrant(jreq({}), p(team, { id }));
    as(owner);
    await addEntrant(jreq({ displayName: 'Gus2' }), p(team, { id })); // 4 entrants → even field

    // start (round paired) then report a match
    await startTournament(noBody(), p(team, { id }));
    const detail = (await (await getDetail(new Request('http://t'), p(team, { id }))).json()).data;
    const match = detail.rounds[0].matches.find((mm: any) => mm.entrant2Id);
    postToChannel.mockClear();
    const res = await reportMatch(jreq({ games: [{ winner: match.entrant1Id }, { winner: match.entrant1Id }] }), p(team, { id, matchId: match.id }));
    expect((await res.json()).ok).toBe(true);
    expect(lastChannel()).toBe('tn');
    expect(postToChannel.mock.calls.at(-1)?.[1]).toMatch(/def\. /);
  });
});

describe('GET/PATCH /api/teams/[slug]/discord — feature channels (owner-only)', () => {
  it('round-trips the override channels and clears them on empty', async () => {
    const owner = await seedUser('owner');
    const stranger = await seedUser('x');
    const team = await seedTeam([owner]);
    await setChannels(team, { main: 'main' });
    await getDb().update(teams).set({ discordGuildId: 'g1' }).where(eq(teams.slug, team));

    as(owner);
    await discordRoute.PATCH(jreq({ reviewChannelId: 'rev', tournamentChannelId: 'tn' }), p(team));
    let body = await (await discordRoute.GET(new Request('http://t'), p(team))).json();
    expect(body.reviewChannelId).toBe('rev');
    expect(body.tournamentChannelId).toBe('tn');

    // empty string clears the override → null (falls back to main)
    await discordRoute.PATCH(jreq({ reviewChannelId: '' }), p(team));
    body = await (await discordRoute.GET(new Request('http://t'), p(team))).json();
    expect(body.reviewChannelId).toBeNull();
    expect(body.tournamentChannelId).toBe('tn');

    // non-owner is blocked
    as(stranger);
    expect((await discordRoute.GET(new Request('http://t'), p(team))).status).toBe(403);
    expect((await discordRoute.PATCH(jreq({ reviewChannelId: 'x' }), p(team))).status).toBe(403);
  });
});
