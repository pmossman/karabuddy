import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { GET as meClips } from '@/app/api/me/clips/route';
import { GET as teamClipsRoute } from '@/app/api/teams/[slug]/clips/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, replays, replayTeamShares, clips } from '@/lib/schema';

// B142: clip browser — list a user's created clips, clips others made of their
// replays, and clips on replays surfaced to a team. Matchup identities
// anonymize per the parent replay's visibility.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const as = (userId: string | null) => vi.mocked(auth).mockResolvedValue(userId ? ({ user: { id: userId } } as any) : (null as any));

async function seedUser(name = 'U') {
  const id = randomUUID();
  await getDb().insert(users).values({ id, name, email: `${id}@e.com` });
  return id;
}
async function seedTeam(owner: string, members: string[] = [owner]) {
  const slug = randomUUID().slice(0, 6);
  await getDb().insert(teams).values({ slug, name: slug, createdBy: owner });
  await getDb().insert(teamMembers).values(members.map((userId) => ({ teamSlug: slug, userId, role: userId === owner ? 'owner' : 'member' })));
  return slug;
}
async function seedReplay(ownerUserId: string | null, ownerToken = `kbx_${randomUUID()}`) {
  const slug = randomUUID().slice(0, 8);
  await getDb().insert(replays).values({
    slug, gameId: randomUUID(), userId: ownerUserId, ownerToken,
    players: [{ id: 'p1', username: 'RealA', leader: { name: 'Boba' } }, { id: 'p2', username: 'RealB', leader: { name: 'Cad' } }],
    ownerPlayerId: 'p1', payloadBlobUrl: `https://blob.test/${slug}.json`,
  });
  return slug;
}
async function seedClip(replaySlug: string, opts: { userId?: string | null; createdBy: string; title?: string }) {
  const slug = `cl_${randomUUID().slice(0, 6)}`;
  await getDb().insert(clips).values({
    slug, replaySlug, startFrame: 2, endFrame: 8, title: opts.title ?? null,
    userId: opts.userId ?? null, createdBy: opts.createdBy,
  });
  return slug;
}
async function share(slug: string, teamSlug: string, by: string) {
  await getDb().insert(replayTeamShares).values({ replaySlug: slug, teamSlug, sharedBy: by });
}

const me = (scope: 'created' | 'on-my-replays', token?: string) =>
  meClips(new Request(`http://t/api/me/clips?scope=${scope}`, { headers: token ? { 'X-Install-Token': token } : {} }));
const teamClipsReq = (teamSlug: string) =>
  teamClipsRoute(new Request('http://t'), { params: Promise.resolve({ slug: teamSlug }) });

beforeEach(() => vi.mocked(auth).mockReset());

describe('B142: my created clips', () => {
  it('returns clips I made (by account or install token), not others’', async () => {
    const me_ = await seedUser();
    const owner = await seedUser();
    const slug = await seedReplay(owner);
    const mine = await seedClip(slug, { userId: me_, createdBy: me_, title: 'mine' });
    await seedClip(slug, { userId: owner, createdBy: owner, title: 'theirs' });

    as(me_);
    const body = await (await me('created')).json();
    expect(body.data.map((c: any) => c.clipSlug)).toEqual([mine]);
    expect(body.data[0].isMine).toBe(true);

    // anonymous creator via install token
    const token = `kb_${randomUUID()}`;
    const anonClip = await seedClip(slug, { userId: null, createdBy: token, title: 'anon' });
    as(null);
    const tokenBody = await (await me('created', token)).json();
    expect(tokenBody.data.map((c: any) => c.clipSlug)).toEqual([anonClip]);
  });

  it('anonymizes the matchup of a clip on a replay I’m not entitled to', async () => {
    const me_ = await seedUser();
    const owner = await seedUser(); // no shared team
    const slug = await seedReplay(owner);
    await seedClip(slug, { userId: me_, createdBy: me_ });

    as(me_);
    const body = await (await me('created')).json();
    const row = body.data[0];
    expect(row.players.map((p: any) => p.username)).toEqual(['Player1', 'Player2']);
    expect(JSON.stringify(row)).not.toContain('RealA');
    // public deck info survives
    expect(row.players.map((p: any) => p.leader?.name)).toEqual(['Boba', 'Cad']);
    expect(row.canDelete).toBe(true); // I created it
  });
});

describe('B142: clips on my replays', () => {
  it('shows others’ clips of my replay, excludes my own, with real names', async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const slug = await seedReplay(owner);
    const theirs = await seedClip(slug, { userId: stranger, createdBy: stranger, title: 'theirs' });
    await seedClip(slug, { userId: owner, createdBy: owner, title: 'mine' });

    as(owner);
    const body = await (await me('on-my-replays')).json();
    expect(body.data.map((c: any) => c.clipSlug)).toEqual([theirs]);
    expect(body.data[0].isMine).toBe(false);
    expect(body.data[0].canDelete).toBe(true); // replay owner can delete
    expect(body.data[0].players.map((p: any) => p.username)).toEqual(['RealA', 'RealB']);
  });
});

describe('B142: team clips', () => {
  it('member sees clips on replays surfaced to the team; non-member 403; signed-out 401', async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const outsider = await seedUser();
    const team = await seedTeam(owner, [owner, member]);
    const slug = await seedReplay(owner);
    await share(slug, team, owner);
    const clip = await seedClip(slug, { userId: owner, createdBy: owner, title: 'team line' });
    // a clip on an UNshared replay must not surface to the team
    const other = await seedReplay(owner);
    await seedClip(other, { userId: owner, createdBy: owner });

    as(member);
    const body = await (await teamClipsReq(team)).json();
    expect(body.data.map((c: any) => c.clipSlug)).toEqual([clip]);

    as(outsider);
    expect((await teamClipsReq(team)).status).toBe(403);

    as(null);
    expect((await teamClipsReq(team)).status).toBe(401);
  });
});
