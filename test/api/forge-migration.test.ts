import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST as forgeMigration } from '@/app/api/teams/[slug]/forge-migration/route';
import { getDb } from '@/lib/db';
import { accounts, teamMembers, teams, users } from '@/lib/schema';
import type { ForgeMigrationPlan } from '@/lib/forgeMigration';

// KaraBuddy → SWU Forge team migration, sending side.
//
// ⚠ The Forge receive route is being built in parallel and is NOT reachable:
// every Forge response here is a stub whose shape is copied verbatim from the
// pinned contract. The two sides have not been run against each other.

const ORIGIN = 'https://forge.test';
const SECRET = 'shared-secret';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const as = (userId: string | null) =>
  vi.mocked(auth).mockResolvedValue(userId ? ({ user: { id: userId } } as any) : (null as any));

function stubForge(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

const planFor = (emails: string[], overrides: Partial<ForgeMigrationPlan> = {}): ForgeMigrationPlan => ({
  outcome: 'created',
  forgeTeamId: 'ckteam1',
  teamUrl: `${ORIGIN}/teams/ckteam1`,
  members: emails.map((email) => ({ email, action: 'invited' as const, role: 'EDITOR' as const })),
  ...overrides,
});

async function seedUser(opts: { email?: string | null; discordId?: string; name?: string } = {}) {
  const id = randomUUID();
  const email = opts.email === undefined ? `${id.slice(0, 8)}@e.com` : opts.email;
  await getDb().insert(users).values({ id, name: opts.name ?? id.slice(0, 4), email });
  if (opts.discordId) {
    await getDb().insert(accounts).values({
      userId: id,
      type: 'oauth',
      provider: 'discord',
      providerAccountId: opts.discordId,
    });
  }
  return { id, email };
}

async function seedTeam(owner: string, members: { id: string; role?: string }[] = []) {
  const slug = randomUUID().slice(0, 6);
  await getDb().insert(teams).values({ slug, name: 'Rebel Cell', createdBy: owner });
  await getDb()
    .insert(teamMembers)
    .values([
      { teamSlug: slug, userId: owner, role: 'owner' },
      ...members.map((m) => ({ teamSlug: slug, userId: m.id, role: m.role ?? 'member' })),
    ]);
  return slug;
}

const post = (slug: string, body: unknown) =>
  forgeMigration(new Request('http://t', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ slug }),
  });

const sentBody = (fetchMock: ReturnType<typeof stubForge>) =>
  JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);

beforeEach(() => {
  vi.mocked(auth).mockReset();
  vi.stubEnv('SWU_FORGE_ORIGIN', ORIGIN);
  vi.stubEnv('TEAM_MIGRATION_SECRET', SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('gating', () => {
  it('404s while the feature is dark (no shared secret set)', async () => {
    vi.stubEnv('TEAM_MIGRATION_SECRET', '');
    const o = await seedUser();
    const slug = await seedTeam(o.id);
    as(o.id);
    const fetchMock = stubForge(200, planFor([]));
    expect((await post(slug, { dryRun: true })).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('401s when signed out', async () => {
    const o = await seedUser();
    const slug = await seedTeam(o.id);
    as(null);
    expect((await post(slug, { dryRun: true })).status).toBe(401);
  });

  it('403s for a plain member — owners only', async () => {
    const o = await seedUser();
    const m = await seedUser();
    const slug = await seedTeam(o.id, [{ id: m.id }]);
    as(m.id);
    const fetchMock = stubForge(200, planFor([]));
    expect((await post(slug, { dryRun: true })).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('403s for a non-member', async () => {
    const o = await seedUser();
    const stranger = await seedUser();
    const slug = await seedTeam(o.id);
    as(stranger.id);
    expect((await post(slug, { dryRun: true })).status).toBe(403);
  });
});

describe('the payload KaraBuddy sends', () => {
  it('carries the namespaced source id, the initiator, and every member with a role', async () => {
    const o = await seedUser({ email: 'Parker@E.com', discordId: '111', name: 'Parker' });
    const coOwner = await seedUser({ email: 'ana@e.com', name: 'Ana' });
    const member = await seedUser({ email: 'corin@e.com', discordId: '222', name: 'Corin' });
    const slug = await seedTeam(o.id, [{ id: coOwner.id, role: 'owner' }, { id: member.id }]);
    as(o.id);
    const fetchMock = stubForge(200, planFor(['ana@e.com', 'corin@e.com']));

    const res = await post(slug, { dryRun: true });
    expect(res.status).toBe(200);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${ORIGIN}/api/team-migration`);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);

    const body = sentBody(fetchMock);
    expect(body.sourceTeamId).toBe(`kb_team_${slug}`);
    expect(body.dryRun).toBe(true);
    expect(body.teamName).toBe('Rebel Cell');
    // Emails are lowercased by the caller, per the contract.
    expect(body.initiator).toEqual({ email: 'parker@e.com', discordUserId: '111' });
    // The initiator is NEVER in members — they are the OWNER.
    expect(body.members).toEqual([
      { email: 'ana@e.com', discordUserId: null, role: 'ADMIN' },
      { email: 'corin@e.com', discordUserId: '222', role: 'EDITOR' },
    ]);
  });

  it('lets the owner override a role per person, and ignores junk roles', async () => {
    const o = await seedUser();
    const a = await seedUser({ email: 'a@e.com' });
    const b = await seedUser({ email: 'b@e.com' });
    const slug = await seedTeam(o.id, [{ id: a.id }, { id: b.id }]);
    as(o.id);
    const fetchMock = stubForge(200, planFor(['a@e.com', 'b@e.com']));

    await post(slug, { dryRun: true, roles: { [a.id]: 'VIEWER', [b.id]: 'OWNER' } });
    const body = sentBody(fetchMock);
    expect(body.members).toEqual([
      { email: 'a@e.com', discordUserId: null, role: 'VIEWER' },
      // OWNER is not assignable via the dropdown — falls back to the default.
      { email: 'b@e.com', discordUserId: null, role: 'EDITOR' },
    ]);
  });

  it('never trusts the browser for identity — a forged member list is ignored', async () => {
    const o = await seedUser();
    const a = await seedUser({ email: 'a@e.com' });
    const slug = await seedTeam(o.id, [{ id: a.id }]);
    as(o.id);
    const fetchMock = stubForge(200, planFor(['a@e.com']));

    await post(slug, {
      dryRun: true,
      members: [{ email: 'attacker@evil.com', discordUserId: '999', role: 'ADMIN' }],
      initiator: { email: 'attacker@evil.com' },
    });
    const body = sentBody(fetchMock);
    expect(body.members).toEqual([{ email: 'a@e.com', discordUserId: null, role: 'EDITOR' }]);
    expect(body.initiator.email).not.toBe('attacker@evil.com');
  });

  it('sends the edited team name, clamped to Forge’s 80 characters', async () => {
    const o = await seedUser();
    const slug = await seedTeam(o.id);
    as(o.id);
    const fetchMock = stubForge(200, planFor([]));

    await post(slug, { dryRun: true, teamName: `  ${'x'.repeat(200)}  ` });
    expect(sentBody(fetchMock).teamName).toHaveLength(80);
  });

  it('400s on an empty team name rather than sending one Forge must reject', async () => {
    const o = await seedUser();
    const slug = await seedTeam(o.id);
    as(o.id);
    const fetchMock = stubForge(200, planFor([]));
    expect((await post(slug, { dryRun: true, teamName: '   ' })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves out a member with no email, and names them as excluded', async () => {
    const o = await seedUser();
    const withEmail = await seedUser({ email: 'a@e.com' });
    const without = await seedUser({ email: null, name: 'Ghost' });
    const slug = await seedTeam(o.id, [{ id: withEmail.id }, { id: without.id }]);
    as(o.id);
    const fetchMock = stubForge(200, planFor(['a@e.com']));

    const body = await (await post(slug, { dryRun: true })).json();
    expect(sentBody(fetchMock).members).toHaveLength(1);
    expect(body.excluded).toEqual([{ userId: without.id, name: 'Ghost' }]);
    expect(body.roster.map((r: any) => r.email)).toEqual(['a@e.com']);
  });

  it('the commit re-sends the identical payload with dryRun: false', async () => {
    const o = await seedUser({ email: 'o@e.com' });
    const a = await seedUser({ email: 'a@e.com' });
    const slug = await seedTeam(o.id, [{ id: a.id }]);
    as(o.id);
    const fetchMock = stubForge(200, planFor(['a@e.com']));

    await post(slug, { dryRun: true, teamName: 'Rebel Cell', roles: { [a.id]: 'VIEWER' } });
    await post(slug, { dryRun: false, teamName: 'Rebel Cell', roles: { [a.id]: 'VIEWER' } });

    const [dry, commit] = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
    expect(dry.dryRun).toBe(true);
    expect(commit.dryRun).toBe(false);
    expect({ ...dry, dryRun: null }).toEqual({ ...commit, dryRun: null });
  });

  it('defaults to a dry run when the body says nothing', async () => {
    const o = await seedUser();
    const slug = await seedTeam(o.id);
    as(o.id);
    const fetchMock = stubForge(200, planFor([]));
    await post(slug, {});
    expect(sentBody(fetchMock).dryRun).toBe(true);
  });
});

describe('what comes back', () => {
  it('returns Forge’s plan untouched, plus the roster the UI joins it onto', async () => {
    const o = await seedUser({ email: 'o@e.com', name: 'Owner' });
    const a = await seedUser({ email: 'a@e.com', name: 'Ana' });
    const slug = await seedTeam(o.id, [{ id: a.id }]);
    as(o.id);
    const plan = planFor(['a@e.com'], {
      outcome: 'updated',
      members: [{ email: 'a@e.com', action: 'skipped_declined', role: 'EDITOR' }],
    });
    stubForge(200, plan);

    const body = await (await post(slug, { dryRun: true })).json();
    expect(body.ok).toBe(true);
    // "declined" is Forge's answer, rendered as-is — KaraBuddy never computes it.
    expect(body.plan).toEqual(plan);
    expect(body.roster).toEqual([
      { userId: a.id, name: 'Ana', image: null, email: 'a@e.com', kbRole: 'member', defaultRole: 'EDITOR', hasDiscord: false },
    ]);
    expect(body.initiator.email).toBe('o@e.com');
  });

  it('maps 409 initiator_has_no_forge_account to its own state with a sign-in link', async () => {
    const o = await seedUser();
    const slug = await seedTeam(o.id);
    as(o.id);
    stubForge(409, { error: 'initiator_has_no_forge_account' });

    const res = await post(slug, { dryRun: true });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('initiator_has_no_forge_account');
    expect(body.signInUrl).toBe(`${ORIGIN}/auth/signin`);
  });

  it('turns a bad credential into a generic 502 that never echoes the secret', async () => {
    const o = await seedUser();
    const slug = await seedTeam(o.id);
    as(o.id);
    stubForge(403, { error: 'forbidden' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await post(slug, { dryRun: true });
    expect(res.status).toBe(502);
    const text = JSON.stringify(await res.json());
    expect(text).toContain('forge_unavailable');
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('403');
    spy.mockRestore();
  });

  it('502s when Forge is unreachable, and when it answers with nonsense', async () => {
    const o = await seedUser();
    const slug = await seedTeam(o.id);
    as(o.id);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    expect((await post(slug, { dryRun: true })).status).toBe(502);

    stubForge(200, { hello: 'world' });
    expect((await post(slug, { dryRun: false })).status).toBe(502);
    spy.mockRestore();
  });

  it('404s for a team that does not exist', async () => {
    const o = await seedUser();
    await seedTeam(o.id);
    as(o.id);
    expect((await post('nosuch', { dryRun: true })).status).toBe(404);
  });
});
