import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { GET as getShares, POST as addShare, DELETE as removeShare } from '@/app/api/replays/[slug]/team-shares/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, replays, replayTeamShares } from '@/lib/schema';
import { eq } from 'drizzle-orm';

// B79: who can share a replay with a team — owner-only AND must be a member of
// the target team (so a slug alone can't pollute a team's grid).

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const as = (userId: string | null) => vi.mocked(auth).mockResolvedValue(userId ? ({ user: { id: userId } } as any) : (null as any));

async function seedUser() {
  const id = randomUUID();
  await getDb().insert(users).values({ id, name: 'U', email: `${id}@e.com` });
  return id;
}
async function seedTeam(owner: string, members: string[] = [owner]) {
  const slug = randomUUID().slice(0, 6);
  await getDb().insert(teams).values({ slug, name: slug, createdBy: owner });
  await getDb().insert(teamMembers).values(members.map((userId) => ({ teamSlug: slug, userId, role: userId === owner ? 'owner' : 'member' })));
  return slug;
}
async function seedReplay(ownerUserId: string) {
  const slug = randomUUID().slice(0, 8);
  await getDb().insert(replays).values({
    slug, gameId: randomUUID(), userId: ownerUserId, ownerToken: `kbx_${randomUUID()}`,
    players: [{ username: 'A' }], payloadBlobUrl: `https://blob.test/${slug}.json`,
  });
  return slug;
}
const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
const post = (slug: string, teamSlug: unknown) => addShare(new Request('http://t', { method: 'POST', body: JSON.stringify({ teamSlug }) }), params(slug));

beforeEach(() => vi.mocked(auth).mockReset());

describe('POST /replays/:slug/team-shares', () => {
  it('owner who is a member can share (idempotently)', async () => {
    const owner = await seedUser();
    const team = await seedTeam(owner);
    const slug = await seedReplay(owner);
    as(owner);

    expect((await post(slug, team)).status).toBe(200);
    expect((await post(slug, team)).status).toBe(200); // idempotent
    const shares = await getDb().select().from(replayTeamShares).where(eq(replayTeamShares.replaySlug, slug));
    expect(shares).toHaveLength(1);
  });

  it('401 when signed out', async () => {
    const owner = await seedUser();
    const slug = await seedReplay(owner);
    as(null);
    expect((await post(slug, 'whatever')).status).toBe(401);
  });

  it('403 when the caller does not own the replay', async () => {
    const owner = await seedUser();
    const team = await seedTeam(owner);
    const slug = await seedReplay(owner);
    const stranger = await seedUser();
    as(stranger);
    expect((await post(slug, team)).status).toBe(403);
  });

  it('403 when the owner is not a member of the target team', async () => {
    const owner = await seedUser();
    const otherOwner = await seedUser();
    const foreignTeam = await seedTeam(otherOwner); // owner is NOT in this team
    const slug = await seedReplay(owner);
    as(owner);
    expect((await post(slug, foreignTeam)).status).toBe(403);
  });

  it('400 without a teamSlug', async () => {
    const owner = await seedUser();
    const slug = await seedReplay(owner);
    as(owner);
    expect((await post(slug, '')).status).toBe(400);
  });
});

describe('GET + DELETE /replays/:slug/team-shares', () => {
  it('GET lists shares + the owner’s teams; non-owner is 403', async () => {
    const owner = await seedUser();
    const team = await seedTeam(owner);
    const slug = await seedReplay(owner);
    as(owner);
    await post(slug, team);

    const body = await (await getShares(new Request('http://t'), params(slug))).json();
    expect(body.ok).toBe(true);
    expect(body.shares.map((s: any) => s.teamSlug)).toEqual([team]);
    expect(body.ownerTeams.map((t: any) => t.slug)).toContain(team);

    as(await seedUser());
    expect((await getShares(new Request('http://t'), params(slug))).status).toBe(403);
  });

  it('DELETE removes a share (owner only)', async () => {
    const owner = await seedUser();
    const team = await seedTeam(owner);
    const slug = await seedReplay(owner);
    as(owner);
    await post(slug, team);

    const res = await removeShare(new Request('http://t', { method: 'DELETE', body: JSON.stringify({ teamSlug: team }) }), params(slug));
    expect(res.status).toBe(200);
    expect(await getDb().select().from(replayTeamShares).where(eq(replayTeamShares.replaySlug, slug))).toHaveLength(0);
  });
});

// B170 / ADR 0010: the team-shares endpoint enforces the same private-team rule
// as the upload path — a plaintext replay can't be shared into a private team,
// and an encrypted replay only into the matching private team.
describe('POST /replays/:slug/team-shares — private-team enforcement', () => {
  async function seedPrivateTeam(owner: string, teamKeyId: string) {
    const slug = randomUUID().slice(0, 6);
    await getDb().insert(teams).values({ slug, name: slug, createdBy: owner, privateMode: true, teamKeyId });
    await getDb().insert(teamMembers).values({ teamSlug: slug, userId: owner, role: 'owner' });
    return slug;
  }
  async function seedEncryptedReplay(owner: string, teamKeyId: string) {
    const slug = randomUUID().slice(0, 8);
    await getDb().insert(replays).values({
      slug, gameId: randomUUID(), userId: owner, ownerToken: `kbx_${randomUUID()}`,
      players: [], payloadBlobUrl: `https://blob.test/${slug}.json`, encrypted: true, teamKeyId, encryptedSummary: '{}',
    });
    return slug;
  }

  it('rejects sharing a PLAINTEXT replay into a private team', async () => {
    const owner = await seedUser();
    const team = await seedPrivateTeam(owner, 'kid1');
    const slug = await seedReplay(owner); // plaintext
    as(owner);
    expect((await post(slug, team)).status).toBe(400);
    expect(await getDb().select().from(replayTeamShares).where(eq(replayTeamShares.replaySlug, slug))).toHaveLength(0);
  });

  it('allows an encrypted replay into the matching private team, rejects a non-private team', async () => {
    const owner = await seedUser();
    const priv = await seedPrivateTeam(owner, 'kid1');
    const pub = await seedTeam(owner);
    const slug = await seedEncryptedReplay(owner, 'kid1');
    as(owner);
    expect((await post(slug, priv)).status).toBe(200);
    expect((await post(slug, pub)).status).toBe(400); // can't decrypt
  });

  it('rejects an encrypted replay whose kid does not match the private team', async () => {
    const owner = await seedUser();
    const team = await seedPrivateTeam(owner, 'kid1');
    const slug = await seedEncryptedReplay(owner, 'kidX');
    as(owner);
    expect((await post(slug, team)).status).toBe(400);
  });
});

// B170/ADR 0010: the GET reports per-team `privateMode` + `shareable` so the
// Share popover disables (with a reason) a team this replay can't be shared to,
// instead of a checkbox that silently won't tick.
describe('GET /replays/:slug/team-shares — shareable flags', () => {
  const get = (slug: string) => getShares(new Request('http://t'), params(slug));
  async function seedPrivateTeam(owner: string, teamKeyId: string) {
    const slug = randomUUID().slice(0, 6);
    await getDb().insert(teams).values({ slug, name: slug, createdBy: owner, privateMode: true, teamKeyId });
    await getDb().insert(teamMembers).values({ teamSlug: slug, userId: owner, role: 'owner' });
    return slug;
  }
  async function seedEncryptedReplay(owner: string, teamKeyId: string) {
    const slug = randomUUID().slice(0, 8);
    await getDb().insert(replays).values({
      slug, gameId: randomUUID(), userId: owner, ownerToken: `kbx_${randomUUID()}`,
      players: [], payloadBlobUrl: `https://blob.test/${slug}.json`, encrypted: true, teamKeyId, encryptedSummary: '{}',
    });
    return slug;
  }

  it('plaintext replay: private team unshareable, open team shareable', async () => {
    const owner = await seedUser();
    const openTeam = await seedTeam(owner);
    const privTeam = await seedPrivateTeam(owner, 'kid1');
    const slug = await seedReplay(owner); // plaintext
    as(owner);
    const body = await (await get(slug)).json();
    const bySlug: Record<string, any> = Object.fromEntries(body.ownerTeams.map((t: any) => [t.slug, t]));
    expect(body.encrypted).toBe(false);
    expect(bySlug[openTeam].shareable).toBe(true);
    expect(bySlug[openTeam].privateMode).toBe(false);
    expect(bySlug[privTeam].shareable).toBe(false);
    expect(bySlug[privTeam].privateMode).toBe(true);
  });

  it('encrypted replay: matching private team shareable, open team not', async () => {
    const owner = await seedUser();
    const openTeam = await seedTeam(owner);
    const privTeam = await seedPrivateTeam(owner, 'kid1');
    const slug = await seedEncryptedReplay(owner, 'kid1');
    as(owner);
    const body = await (await get(slug)).json();
    const bySlug: Record<string, any> = Object.fromEntries(body.ownerTeams.map((t: any) => [t.slug, t]));
    expect(body.encrypted).toBe(true);
    expect(bySlug[privTeam].shareable).toBe(true);
    expect(bySlug[openTeam].shareable).toBe(false);
  });
});
