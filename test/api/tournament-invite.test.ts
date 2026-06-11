import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers } from '@/lib/schema';
import { POST as createTournament } from '@/app/api/teams/[slug]/tournaments/route';
import { GET as getDetail } from '@/app/api/teams/[slug]/tournaments/[id]/route';
import { POST as addEntrant } from '@/app/api/teams/[slug]/tournaments/[id]/entrants/route';
import { POST as startTournament } from '@/app/api/teams/[slug]/tournaments/[id]/start/route';
import { POST as mintInvite } from '@/app/api/teams/[slug]/tournaments/[id]/invite/route';
import { GET as inviteInfo } from '@/app/api/tournaments/invite/[code]/route';
import { POST as inviteRegister } from '@/app/api/tournaments/invite/[code]/register/route';
import { POST as inviteClaim } from '@/app/api/tournaments/invite/[code]/claim/route';
import { PATCH as patchTournament } from '@/app/api/teams/[slug]/tournaments/[id]/route';
import { GET as listTournaments } from '@/app/api/teams/[slug]/tournaments/route';
import { POST as reportMatch } from '@/app/api/teams/[slug]/tournaments/[id]/matches/[matchId]/report/route';
import { getTeamMembership } from '@/lib/teamSurface';

// B126: public tournament invite links — guest self-registration + the
// guest→member account claim.

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
  await getDb().insert(teamMembers).values(members.map((u, i) => ({ teamSlug: slug, userId: u, role: i === 0 ? 'owner' : 'member' })));
  return slug;
}
const p = (params: Record<string, string>) => ({ params: Promise.resolve(params) as any });
const jreq = (body: unknown) => new Request('http://t/x', { method: 'POST', body: JSON.stringify(body) });
const noBody = () => new Request('http://t/x', { method: 'POST' });

async function setup() {
  const owner = await seedUser('owner');
  const slug = await seedTeam([owner]);
  as(owner);
  const id = (await (await createTournament(jreq({ name: 'Open Cup' }), p({ slug }))).json()).id as string;
  const mint = await (await mintInvite(noBody(), p({ slug, id }))).json();
  expect(mint.ok).toBe(true);
  return { owner, slug, id, code: mint.code as string };
}

beforeEach(() => vi.mocked(auth).mockReset());

describe('invite mint', () => {
  it('is organizer-only and stable across calls', async () => {
    const { owner, slug, id, code } = await setup();
    const member = await seedUser('member');
    await getDb().insert(teamMembers).values({ teamSlug: slug, userId: member, role: 'member' });
    as(member);
    expect((await mintInvite(noBody(), p({ slug, id }))).status).toBe(403);
    as(owner);
    const again = await (await mintInvite(noBody(), p({ slug, id }))).json();
    expect(again.code).toBe(code); // get-or-create, not regenerate

    // The detail GET surfaces it to the organizer only.
    const d = await (await getDetail(new Request('http://t'), p({ slug, id }))).json();
    expect(d.data.tournament.inviteCode).toBe(code);
    as(member);
    const dm = await (await getDetail(new Request('http://t'), p({ slug, id }))).json();
    expect(dm.data.tournament.inviteCode).toBeNull();
  });
});

describe('public invite info + registration', () => {
  it('GET is public; bogus code 404s', async () => {
    const { code } = await setup();
    as(null);
    const info = await (await inviteInfo(new Request('http://t'), p({ code }))).json();
    expect(info.ok).toBe(true);
    expect(info.data.tournament.name).toBe('Open Cup');
    expect(info.data.registrationOpen).toBe(true);
    expect(info.data.viewer).toMatchObject({ signedIn: false, isMember: false });
    expect((await inviteInfo(new Request('http://t'), p({ code: 'bogus' }))).status).toBe(404);
  });

  it('signed-out guest registers with a name; gets a claimToken; dup names 409', async () => {
    const { owner, slug, id, code } = await setup();
    as(null);
    const reg = await (await inviteRegister(jreq({ displayName: 'Walk-in Will' }), p({ code }))).json();
    expect(reg.ok).toBe(true);
    expect(reg.claimToken).toMatch(/^tc_/);
    expect((await inviteRegister(jreq({ displayName: 'walk-in will' }), p({ code }))).status).toBe(409); // ci dup
    expect((await inviteRegister(jreq({}), p({ code }))).status).toBe(400); // name required

    as(owner);
    const d = await (await getDetail(new Request('http://t'), p({ slug, id }))).json();
    expect(d.data.entrants).toHaveLength(1);
    expect(d.data.entrants[0]).toMatchObject({ displayName: 'Walk-in Will', userId: null });
    expect(d.data.entrants[0].claimToken).toBe(reg.claimToken); // organizer sees it
  });

  it('signed-in non-member registers LINKED (account name); member is told to use the tournament page', async () => {
    const { owner, slug, id, code } = await setup();
    const outsider = await seedUser('outsider');
    as(outsider);
    const reg = await (await inviteRegister(jreq({}), p({ code }))).json();
    expect(reg.ok).toBe(true);
    expect(reg.claimToken).toBeNull(); // already linked — nothing to claim

    as(owner);
    const d = await (await getDetail(new Request('http://t'), p({ slug, id }))).json();
    expect(d.data.entrants[0].userId).toBe(outsider);

    expect((await inviteRegister(jreq({}), p({ code }))).status).toBe(409); // owner is a member
  });

  it('B127: a linked entrant gets TOURNAMENT-scoped access — not team access', async () => {
    const { owner, slug, id, code } = await setup();
    as(owner);
    await addEntrant(jreq({}), p({ slug, id })); // owner registers too
    const outsider = await seedUser('outsider');
    as(outsider);
    await inviteRegister(jreq({}), p({ code }));

    // Detail page payload: visible, flagged non-member, no organizer secrets.
    const d = await (await getDetail(new Request('http://t'), p({ slug, id }))).json();
    expect(d.ok).toBe(true);
    expect(d.data.viewer).toMatchObject({ isMember: false, isOrganizer: false });
    expect(d.data.tournament.inviteCode).toBeNull();

    // Their own registration is manageable (decklist PATCH path is exercised in
    // the entrants suite); tournament SETTINGS are not.
    expect((await patchTournament(jreq({ name: 'Hijacked' }), p({ slug, id }))).status).toBe(403);
    // The team's tournament LIST stays member-only.
    expect((await listTournaments(new Request('http://t'), p({ slug }))).status).toBe(403);
    // And they never became a team member.
    expect(await getTeamMembership(slug, outsider)).toBeNull();
  });

  it('B127: a linked entrant can report their own match after the tournament starts', async () => {
    const { owner, slug, id, code } = await setup();
    as(owner);
    await addEntrant(jreq({}), p({ slug, id }));
    const outsider = await seedUser('outsider');
    as(outsider);
    await inviteRegister(jreq({}), p({ code }));
    as(owner);
    await startTournament(noBody(), p({ slug, id }));

    as(outsider);
    const d = await (await getDetail(new Request('http://t'), p({ slug, id }))).json();
    const myEntrantId = d.data.viewer.entrantId;
    const match = d.data.rounds[0].matches.find((m: any) => [m.entrant1Id, m.entrant2Id].includes(myEntrantId));
    const rep = await reportMatch(
      jreq({ games: [{ winner: myEntrantId }, { winner: myEntrantId }] }),
      p({ slug, id, matchId: match.id })
    );
    expect((await rep.json()).status).toBe('reported'); // player report, not organizer
  });

  it('registration closes when the tournament starts', async () => {
    const { owner, slug, id, code } = await setup();
    as(null);
    await inviteRegister(jreq({ displayName: 'G1' }), p({ code }));
    await inviteRegister(jreq({ displayName: 'G2' }), p({ code }));
    as(owner);
    await startTournament(noBody(), p({ slug, id }));
    as(null);
    expect((await inviteRegister(jreq({ displayName: 'Late' }), p({ code }))).status).toBe(409);
  });
});

describe('claim', () => {
  it('claim links the entrant to the account + renames it + burns the token — WITHOUT joining the team (B127)', async () => {
    const { owner, slug, id, code } = await setup();
    as(null);
    const reg = await (await inviteRegister(jreq({ displayName: 'Guesty' }), p({ code }))).json();

    const newUser = await seedUser('fresh');
    as(newUser);
    const claim = await (await inviteClaim(jreq({ claimToken: reg.claimToken }), p({ code }))).json();
    expect(claim).toMatchObject({ ok: true, teamSlug: slug, tournamentId: id });
    // Decoupled: claiming grants TOURNAMENT access, never team membership.
    expect(await getTeamMembership(slug, newUser)).toBeNull();
    // …but the tournament page now opens for them.
    const mine = await (await getDetail(new Request('http://t'), p({ slug, id }))).json();
    expect(mine.ok).toBe(true);
    expect(mine.data.viewer.isMember).toBe(false);

    as(owner);
    const d = await (await getDetail(new Request('http://t'), p({ slug, id }))).json();
    expect(d.data.entrants[0].userId).toBe(newUser);
    expect(d.data.entrants[0].displayName).toContain('fresh'); // account name
    expect(d.data.entrants[0].claimToken).toBeNull(); // single-use

    // Replaying the claim fails.
    as(newUser);
    expect((await inviteClaim(jreq({ claimToken: reg.claimToken }), p({ code }))).status).toBe(404);
  });

  it('claim refuses when the account already has an entry; requires sign-in; bad token 404', async () => {
    const { owner, slug, id, code } = await setup();
    as(null);
    const reg = await (await inviteRegister(jreq({ displayName: 'Guesty' }), p({ code }))).json();
    as(owner);
    await addEntrant(jreq({}), p({ slug, id })); // owner registers themselves
    expect((await inviteClaim(jreq({ claimToken: reg.claimToken }), p({ code }))).status).toBe(409); // dup account entry
    as(null);
    expect((await inviteClaim(jreq({ claimToken: reg.claimToken }), p({ code }))).status).toBe(401);
    const someone = await seedUser();
    as(someone);
    expect((await inviteClaim(jreq({ claimToken: 'tc_bogus' }), p({ code }))).status).toBe(404);
  });

  it('a signed-in NON-entrant non-member still cannot view the tournament', async () => {
    const { slug, id } = await setup();
    const bystander = await seedUser('bystander');
    as(bystander);
    expect((await getDetail(new Request('http://t'), p({ slug, id }))).status).toBe(403);
  });
});
