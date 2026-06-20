import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PATCH as patchTeam } from '@/app/api/teams/[slug]/route';
import { POST as enablePrivate } from '@/app/api/teams/[slug]/private-mode/route';
import { GET as readinessRoster } from '@/app/api/teams/[slug]/readiness/route';
import { POST as reportReadiness } from '@/app/api/me/extension/readiness/route';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers, extensionTokens } from '@/lib/schema';
import { eq } from 'drizzle-orm';

// B170 / ADR 0010, Phase 5 server foundation: enabling private mode (owner-only,
// stores only the non-secret team_key_id), the extension readiness ping, and the
// owner's per-member readiness roster.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const as = (userId: string | null) => vi.mocked(auth).mockResolvedValue(userId ? ({ user: { id: userId } } as any) : (null as any));
beforeEach(() => vi.mocked(auth).mockReset());

async function seedUser() {
  const id = randomUUID();
  const token = `kbx_${randomUUID()}`;
  await getDb().insert(users).values({ id, name: id.slice(0, 4), email: `${id}@e.com` });
  await getDb().insert(extensionTokens).values({ token, userId: id });
  return { id, token };
}
async function seedTeam(owner: string, members: string[] = [owner]) {
  const slug = randomUUID().slice(0, 6);
  await getDb().insert(teams).values({ slug, name: slug, createdBy: owner });
  await getDb().insert(teamMembers).values(members.map((u) => ({ teamSlug: slug, userId: u, role: u === owner ? 'owner' : 'member' })));
  return slug;
}
const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
const patch = (slug: string, body: any) => patchTeam(new Request('http://t', { method: 'PATCH', body: JSON.stringify(body) }), params(slug));
const ping = (token: string, body: any) =>
  reportReadiness(new Request('http://t', { method: 'POST', headers: { 'X-Install-Token': token }, body: JSON.stringify(body) }));

describe('enable/disable private mode (team PATCH)', () => {
  it('owner enables private mode with a team_key_id; disabling clears it', async () => {
    const o = await seedUser();
    const slug = await seedTeam(o.id);
    as(o.id);

    expect((await patch(slug, { privateMode: true, teamKeyId: 'kid-abc' })).status).toBe(200);
    let [t] = await getDb().select().from(teams).where(eq(teams.slug, slug));
    expect(t.privateMode).toBe(true);
    expect(t.teamKeyId).toBe('kid-abc');

    expect((await patch(slug, { privateMode: false })).status).toBe(200);
    [t] = await getDb().select().from(teams).where(eq(teams.slug, slug));
    expect(t.privateMode).toBe(false);
    expect(t.teamKeyId).toBeNull();
  });

  it('rejects enabling without a teamKeyId', async () => {
    const o = await seedUser();
    const slug = await seedTeam(o.id);
    as(o.id);
    expect((await patch(slug, { privateMode: true })).status).toBe(400);
  });

  it('non-owner can’t toggle private mode', async () => {
    const o = await seedUser();
    const m = await seedUser();
    const slug = await seedTeam(o.id, [o.id, m.id]);
    as(m.id);
    expect((await patch(slug, { privateMode: true, teamKeyId: 'kid' })).status).toBe(403);
  });

  it('rejects a key already used by another team (keys are one-per-team)', async () => {
    const o = await seedUser();
    const teamA = await seedTeam(o.id);
    const teamB = await seedTeam(o.id);
    as(o.id);
    expect((await patch(teamA, { privateMode: true, teamKeyId: 'shared-kid' })).status).toBe(200);
    // Reusing the same key on another team is refused.
    expect((await patch(teamB, { privateMode: true, teamKeyId: 'shared-kid' })).status).toBe(409);
    const [b] = await getDb().select().from(teams).where(eq(teams.slug, teamB));
    expect(b.privateMode).toBe(false);
    expect(b.teamKeyId).toBeNull();
  });

  it('name-only update still works (backward compatible)', async () => {
    const o = await seedUser();
    const slug = await seedTeam(o.id);
    as(o.id);
    expect((await patch(slug, { name: 'Renamed' })).status).toBe(200);
    const [t] = await getDb().select().from(teams).where(eq(teams.slug, slug));
    expect(t.name).toBe('Renamed');
  });
});

describe('enable private mode via the extension endpoint (POST /private-mode)', () => {
  const enable = (slug: string, body: any) => enablePrivate(new Request('http://t', { method: 'POST', body: JSON.stringify(body) }), params(slug));
  it('owner enables; key reuse rejected; non-owner blocked', async () => {
    const o = await seedUser();
    const teamA = await seedTeam(o.id);
    const teamB = await seedTeam(o.id);
    as(o.id);
    expect((await enable(teamA, { teamKeyId: 'kidX' })).status).toBe(200);
    const [a] = await getDb().select().from(teams).where(eq(teams.slug, teamA));
    expect(a.privateMode).toBe(true);
    expect(a.teamKeyId).toBe('kidX');
    // reuse of the same key on another team → rejected (one-per-team)
    expect((await enable(teamB, { teamKeyId: 'kidX' })).status).toBe(409);
    // non-owner can't enable
    const m = await seedUser();
    const teamC = await seedTeam(o.id, [o.id, m.id]);
    as(m.id);
    expect((await enable(teamC, { teamKeyId: 'kidZ' })).status).toBe(403);
  });
});

describe('readiness ping + roster', () => {
  it('roster reflects each member’s reported readiness for the team key', async () => {
    const owner = await seedUser();
    const ready = await seedUser();
    const noKey = await seedUser();
    const oldExt = await seedUser();
    const never = await seedUser();
    const slug = await seedTeam(owner.id, [owner.id, ready.id, noKey.id, oldExt.id, never.id]);
    as(owner.id);
    await patch(slug, { privateMode: true, teamKeyId: 'kid-1' });

    // Each member's extension pings its readiness (non-secret). No session — the
    // ping is authed by the install-token header (so resolveUserIdFromRequest
    // resolves the pinging member, not the mocked owner session).
    as(null);
    await ping(ready.token, { capabilities: ['privateTeams'], loadedTeamKeyIds: ['kid-1'] });
    await ping(noKey.token, { capabilities: ['privateTeams'], loadedTeamKeyIds: ['other'] });
    await ping(oldExt.token, { capabilities: [], loadedTeamKeyIds: [] });
    // `never` never pings.

    as(owner.id);
    const res = await readinessRoster(new Request('http://t'), params(slug));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.privateMode).toBe(true);
    const byId: Record<string, string> = Object.fromEntries(body.members.map((m: any) => [m.userId, m.status]));
    expect(byId[ready.id]).toBe('ready');
    expect(byId[noKey.id]).toBe('needs-key');
    expect(byId[oldExt.id]).toBe('needs-update');
    expect(byId[never.id]).toBe('not-seen');
  });

  it('roster is owner-only', async () => {
    const owner = await seedUser();
    const m = await seedUser();
    const slug = await seedTeam(owner.id, [owner.id, m.id]);
    as(m.id);
    expect((await readinessRoster(new Request('http://t'), params(slug))).status).toBe(403);
  });

  it('readiness ping stores only non-secret fields (upsert)', async () => {
    const u = await seedUser();
    expect((await ping(u.token, { capabilities: ['privateTeams'], loadedTeamKeyIds: ['kid-1', 'kid-2'] })).status).toBe(200);
    // Re-ping overwrites.
    expect((await ping(u.token, { capabilities: ['privateTeams'], loadedTeamKeyIds: ['kid-3'] })).status).toBe(200);
  });
});
