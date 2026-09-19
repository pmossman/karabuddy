import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  callForgeMigration,
  clampTeamName,
  defaultRoleFor,
  forgeMigrationEnabled,
  forgeSignInUrl,
  isForgeRole,
  isRoleEditable,
  normalizeEmail,
  sourceTeamId,
  summarizePlan,
  FORGE_TEAM_NAME_MAX,
  type ForgeMigrationPlan,
  type ForgeMigrationRequest,
} from './forgeMigration';

// Sending side of the KaraBuddy → SWU Forge team migration. Forge is being
// built in parallel and is not reachable, so every call here is exercised
// against a stub whose shapes come verbatim from the pinned contract.

const ORIGIN = 'https://forge.test';
const SECRET = 'shared-secret';

function plan(overrides: Partial<ForgeMigrationPlan> = {}): ForgeMigrationPlan {
  return {
    outcome: 'created',
    forgeTeamId: 'ckteam1',
    teamUrl: 'https://forge.test/teams/ckteam1',
    members: [
      { email: 'ana@e.com', action: 'joined', role: 'ADMIN' },
      { email: 'corin@e.com', action: 'invited', role: 'EDITOR' },
    ],
    ...overrides,
  };
}

function request(): ForgeMigrationRequest {
  return {
    sourceTeamId: 'kb_team_abc123',
    teamName: 'Rebel Cell',
    dryRun: true,
    initiator: { email: 'parker@e.com', discordUserId: '111' },
    members: [{ email: 'ana@e.com', discordUserId: null, role: 'ADMIN' }],
  };
}

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  vi.stubEnv('SWU_FORGE_ORIGIN', ORIGIN);
  vi.stubEnv('TEAM_MIGRATION_SECRET', SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('flag gating', () => {
  it('needs BOTH the origin and the secret — a half-configured deploy stays dark', () => {
    expect(forgeMigrationEnabled()).toBe(true);
    vi.stubEnv('TEAM_MIGRATION_SECRET', '');
    expect(forgeMigrationEnabled()).toBe(false);
    vi.stubEnv('TEAM_MIGRATION_SECRET', SECRET);
    vi.stubEnv('SWU_FORGE_ORIGIN', '');
    expect(forgeMigrationEnabled()).toBe(false);
  });

  it('tolerates a trailing slash on the origin', () => {
    vi.stubEnv('SWU_FORGE_ORIGIN', 'https://forge.test/');
    expect(forgeSignInUrl()).toBe('https://forge.test/auth/signin');
  });
});

describe('payload helpers', () => {
  it('namespaces the KaraBuddy slug as the idempotency key', () => {
    expect(sourceTeamId('abc123')).toBe('kb_team_abc123');
  });

  it('defaults a co-owner to ADMIN and everyone else to EDITOR (never VIEWER)', () => {
    expect(defaultRoleFor('owner')).toBe('ADMIN');
    expect(defaultRoleFor('member')).toBe('EDITOR');
    expect(defaultRoleFor('anything-else')).toBe('EDITOR');
  });

  it('lowercases and trims emails caller-side, as the contract requires', () => {
    expect(normalizeEmail('  Ana.Vos@Example.COM ')).toBe('ana.vos@example.com');
    expect(normalizeEmail(null)).toBe('');
  });

  it('clamps the team name to Forge’s 80-character limit', () => {
    expect(FORGE_TEAM_NAME_MAX).toBe(80);
    expect(clampTeamName('  Rebel Cell  ')).toBe('Rebel Cell');
    expect(clampTeamName('x'.repeat(200))).toHaveLength(80);
  });

  it('only accepts the three assignable roles — OWNER is not one of them', () => {
    expect(isForgeRole('EDITOR')).toBe(true);
    expect(isForgeRole('ADMIN')).toBe(true);
    expect(isForgeRole('VIEWER')).toBe(true);
    expect(isForgeRole('OWNER')).toBe(false);
    expect(isForgeRole('member')).toBe(false);
  });
});

describe('callForgeMigration', () => {
  it('sends the bearer credential and the payload verbatim, and returns the plan', async () => {
    const fetchMock = stubFetch(200, plan());
    const result = await callForgeMigration(request());

    expect(result).toEqual({ ok: true, plan: plan() });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${ORIGIN}/api/team-migration`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(init.body as string)).toEqual(request());
  });

  it('the dry run and the commit differ ONLY by dryRun', async () => {
    const fetchMock = stubFetch(200, plan());
    await callForgeMigration({ ...request(), dryRun: true });
    await callForgeMigration({ ...request(), dryRun: false });
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string) as Record<string, unknown>);
    expect(bodies[0].dryRun).toBe(true);
    expect(bodies[1].dryRun).toBe(false);
    expect({ ...bodies[0], dryRun: null }).toEqual({ ...bodies[1], dryRun: null });
  });

  it('maps 409 initiator_has_no_forge_account to its own state', async () => {
    stubFetch(409, { error: 'initiator_has_no_forge_account' });
    expect(await callForgeMigration(request())).toEqual({ ok: false, failure: { kind: 'no_forge_account' } });
  });

  it('collapses 403 and 422 into a generic rejection (never surfacing the secret)', async () => {
    stubFetch(403, { error: 'forbidden' });
    expect(await callForgeMigration(request())).toEqual({ ok: false, failure: { kind: 'rejected', status: 403 } });
    stubFetch(422, { error: 'invalid payload' });
    expect(await callForgeMigration(request())).toEqual({ ok: false, failure: { kind: 'rejected', status: 422 } });
  });

  it('does not treat a 409 with a DIFFERENT error code as "no account"', async () => {
    stubFetch(409, { error: 'something_else' });
    expect(await callForgeMigration(request())).toEqual({ ok: false, failure: { kind: 'rejected', status: 409 } });
  });

  it('reports an unreachable Forge rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const result = await callForgeMigration(request());
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure.kind).toBe('unreachable');
  });

  it('rejects a 200 whose body is not the contract shape', async () => {
    stubFetch(200, { outcome: 'created', forgeTeamId: 'x' });
    const result = await callForgeMigration(request());
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure.kind).toBe('bad_response');
  });

  it('is unreachable when the feature is not configured', async () => {
    vi.stubEnv('TEAM_MIGRATION_SECRET', '');
    const fetchMock = stubFetch(200, plan());
    const result = await callForgeMigration(request());
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('reading Forge’s plan', () => {
  it('counts every action the contract defines', () => {
    const s = summarizePlan(
      plan({
        outcome: 'updated',
        members: [
          { email: 'a@e.com', action: 'joined', role: 'EDITOR' },
          { email: 'b@e.com', action: 'invited', role: 'EDITOR' },
          { email: 'c@e.com', action: 'skipped_already_offered', role: 'EDITOR' },
          { email: 'd@e.com', action: 'skipped_declined', role: 'EDITOR' },
          { email: 'e@e.com', action: 'skipped_existing_member', role: 'ADMIN' },
        ],
      }),
    );
    expect(s).toEqual({
      total: 5,
      joined: 1,
      invited: 1,
      alreadyOffered: 1,
      declined: 1,
      existingMember: 1,
      actionable: 2,
    });
  });

  // Rules 3 and 4: a member already on the team keeps their Forge role, and an
  // email already in the ledger is never re-offered — so the preview's dropdown
  // has nothing left to say about either.
  it('only leaves the role dropdown live for members Forge would still act on', () => {
    expect(isRoleEditable('joined')).toBe(true);
    expect(isRoleEditable('invited')).toBe(true);
    expect(isRoleEditable('skipped_already_offered')).toBe(false);
    expect(isRoleEditable('skipped_declined')).toBe(false);
    expect(isRoleEditable('skipped_existing_member')).toBe(false);
  });
});
