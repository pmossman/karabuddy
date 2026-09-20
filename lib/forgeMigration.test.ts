import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  callForgeMigration,
  callerOrigin,
  clampTeamName,
  defaultRoleFor,
  forgeMigrationEnabled,
  forgeOrigin,
  isForgeBlockCode,
  isForgeRole,
  isMigrationBlockCode,
  isRoleEditable,
  isTeamMigrationAllowedUser,
  normalizeEmail,
  teamMigrationAllowlist,
  sourceTeamId,
  summarizePlan,
  FORGE_MAX_MEMBERS,
  FORGE_TEAM_NAME_MAX,
  type ForgeMigrationPlan,
  type ForgeMigrationRequest,
} from './forgeMigration';

// Sending side of the KaraBuddy → SWU Forge team migration. The stubs here are
// shaped from the pinned contract and its amendments, and every shape in this
// file has since been seen coming off the real receive route in a local
// end-to-end run — including the null `forgeTeamId` / `teamUrl` of a first
// preview and all five 409 bodies.

const ORIGIN = 'https://forge.test';
const SECRET = 'shared-secret';
// KaraBuddy's OWN origin — what it states in the `Origin` header, and what
// Forge pins in TEAM_MIGRATION_ALLOWED_ORIGINS.
const SELF = 'https://karabuddy.app';

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
  vi.stubEnv('AUTH_URL', SELF);
  vi.stubEnv('KARABUDDY_ORIGIN', '');
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
    expect(forgeOrigin()).toBe('https://forge.test');
  });
});

// ⏳ The limited production trial gate. Confirming the move sends real
// invitation emails that Forge's ledger will not let us re-offer, so "hidden"
// is not the same as "restricted" — this decides who may ACT.
describe('the limited-trial allowlist', () => {
  it('is FAIL CLOSED — an absent list is off for everyone', () => {
    vi.stubEnv('TEAM_MIGRATION_ALLOWED_USERS', undefined);
    expect(teamMigrationAllowlist()).toEqual([]);
    expect(isTeamMigrationAllowedUser('parker@e.com')).toBe(false);
  });

  it('is FAIL CLOSED — an empty (or comma-only) list is off for everyone', () => {
    vi.stubEnv('TEAM_MIGRATION_ALLOWED_USERS', '');
    expect(isTeamMigrationAllowedUser('parker@e.com')).toBe(false);
    vi.stubEnv('TEAM_MIGRATION_ALLOWED_USERS', '  ');
    expect(isTeamMigrationAllowedUser('parker@e.com')).toBe(false);
    // ⛔ The one shape that must never read as "allow all": a stray comma.
    vi.stubEnv('TEAM_MIGRATION_ALLOWED_USERS', ',,');
    expect(teamMigrationAllowlist()).toEqual([]);
    expect(isTeamMigrationAllowedUser('parker@e.com')).toBe(false);
  });

  it('lets through exactly the listed addresses, and nobody else', () => {
    vi.stubEnv('TEAM_MIGRATION_ALLOWED_USERS', 'parker@e.com,ana@e.com');
    expect(isTeamMigrationAllowedUser('parker@e.com')).toBe(true);
    expect(isTeamMigrationAllowedUser('ana@e.com')).toBe(true);
    expect(isTeamMigrationAllowedUser('corin@e.com')).toBe(false);
  });

  it('matches case-insensitively and ignores surrounding whitespace on both sides', () => {
    vi.stubEnv('TEAM_MIGRATION_ALLOWED_USERS', ' Parker@E.Com , ana@e.com ');
    expect(teamMigrationAllowlist()).toEqual(['parker@e.com', 'ana@e.com']);
    expect(isTeamMigrationAllowedUser('PARKER@e.com')).toBe(true);
    expect(isTeamMigrationAllowedUser('  parker@e.com  ')).toBe(true);
  });

  it('refuses a user with no email rather than matching an empty entry', () => {
    vi.stubEnv('TEAM_MIGRATION_ALLOWED_USERS', 'parker@e.com');
    expect(isTeamMigrationAllowedUser(null)).toBe(false);
    expect(isTeamMigrationAllowedUser(undefined)).toBe(false);
    expect(isTeamMigrationAllowedUser('')).toBe(false);
  });

  it('stacks with the env flag instead of replacing it — both are separate answers', () => {
    vi.stubEnv('TEAM_MIGRATION_ALLOWED_USERS', 'parker@e.com');
    vi.stubEnv('TEAM_MIGRATION_SECRET', '');
    // The allowlist still says yes; the feature is still dark. Callers must ask
    // both, which is what the card and the two routes do.
    expect(isTeamMigrationAllowedUser('parker@e.com')).toBe(true);
    expect(forgeMigrationEnabled()).toBe(false);
  });
});

// ⚠ Node's fetch sends NO Origin header server-to-server, and Forge refuses any
// request that arrives without one — every call 403'd until KaraBuddy stated it
// itself. The value has to be something TEAM_MIGRATION_ALLOWED_ORIGINS can hold:
// a bare scheme://host[:port], never a path.
describe('the origin KaraBuddy states it is calling from', () => {
  it('is this deploy’s own origin, taken from AUTH_URL', () => {
    vi.stubEnv('AUTH_URL', 'https://karabuddy.app');
    expect(callerOrigin()).toBe('https://karabuddy.app');
  });

  it('strips any path, so the value is one an allow-list can hold verbatim', () => {
    vi.stubEnv('AUTH_URL', 'https://karabuddy.app/api/auth');
    expect(callerOrigin()).toBe('https://karabuddy.app');
  });

  it('keeps the port — localhost:3001 and the prod host are different origins', () => {
    vi.stubEnv('AUTH_URL', 'http://localhost:3001');
    expect(callerOrigin()).toBe('http://localhost:3001');
  });

  it('lets KARABUDDY_ORIGIN override it — the shadow project is reached elsewhere', () => {
    vi.stubEnv('AUTH_URL', 'https://karabuddy.app');
    vi.stubEnv('KARABUDDY_ORIGIN', 'https://karabuddy-shadow.vercel.app');
    expect(callerOrigin()).toBe('https://karabuddy-shadow.vercel.app');
  });

  it('is empty rather than guessed when there is nothing to read it from', () => {
    vi.stubEnv('AUTH_URL', '');
    expect(callerOrigin()).toBe('');
    vi.stubEnv('AUTH_URL', 'not a url');
    expect(callerOrigin()).toBe('');
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
    // 🔴 Without this header Forge answers 403 to every single call — Node sets
    // no Origin on a server-to-server request, and an absent one is refused.
    expect((init.headers as Record<string, string>).Origin).toBe(SELF);
    expect(JSON.parse(init.body as string)).toEqual(request());
  });

  it('refuses to call at all when it cannot state its own origin', async () => {
    vi.stubEnv('AUTH_URL', '');
    const fetchMock = stubFetch(200, plan());
    const result = await callForgeMigration(request());
    // ⛔ Never a plausible-looking fallback: the pin exists to say where we
    // really are, and a guessed origin is either a 403 or a lie.
    expect(result).toEqual({
      ok: false,
      failure: { kind: 'unreachable', detail: 'KaraBuddy cannot state its own origin (AUTH_URL unset)' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
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

  it('maps 409 initiator_has_no_forge_account to its own state, with FORGE’S sign-in url', async () => {
    // 🔒 Amendment 3: the URL is Forge's to own and it ships it in the body.
    // KaraBuddy used to derive `${SWU_FORGE_ORIGIN}/auth/signin` — a guess about
    // another app's Auth.js config, one refactor from a 404 nobody would notice.
    stubFetch(409, { error: 'initiator_has_no_forge_account', signInUrl: 'https://forge.test/auth/signin' });
    expect(await callForgeMigration(request())).toEqual({
      ok: false,
      failure: {
        kind: 'blocked',
        block: {
          code: 'initiator_has_no_forge_account',
          signInUrl: 'https://forge.test/auth/signin',
          cap: null,
          used: null,
          requested: null,
        },
      },
    });
  });

  it('shows the state with no button rather than inventing a url Forge didn’t send', async () => {
    stubFetch(409, { error: 'initiator_has_no_forge_account' });
    const result = await callForgeMigration(request());
    expect(result.ok === false && result.failure.kind === 'blocked' && result.failure.block.signInUrl).toBe(null);
  });

  // Every one of these is reachable on a DRY RUN by design — the preview is
  // where a human is meant to meet them, with nothing written yet. Collapsing
  // them into one generic failure hides the single fact the owner needs.
  it('gives the seat/cap/authority refusals their own states, carrying Forge’s numbers', async () => {
    stubFetch(409, { error: 'seats_full', message: 'Teams are limited to 25 members.', cap: 25, used: 20, requested: 9 });
    expect(await callForgeMigration(request())).toEqual({
      ok: false,
      failure: { kind: 'blocked', block: { code: 'seats_full', signInUrl: null, cap: 25, used: 20, requested: 9 } },
    });

    stubFetch(409, { error: 'team_cap_reached', message: 'This profile is already in the maximum number of teams (10).', cap: 10 });
    expect(await callForgeMigration(request())).toEqual({
      ok: false,
      failure: { kind: 'blocked', block: { code: 'team_cap_reached', signInUrl: null, cap: 10, used: null, requested: null } },
    });

    stubFetch(409, { error: 'initiator_not_team_admin', message: 'This team has already moved to SWU Forge…' });
    expect(await callForgeMigration(request())).toEqual({
      ok: false,
      failure: { kind: 'blocked', block: { code: 'initiator_not_team_admin', signInUrl: null, cap: null, used: null, requested: null } },
    });

    stubFetch(409, { error: 'initiator_has_no_profile', message: 'The team owner has no SWU Forge profile…' });
    expect(await callForgeMigration(request())).toEqual({
      ok: false,
      failure: { kind: 'blocked', block: { code: 'initiator_has_no_profile', signInUrl: null, cap: null, used: null, requested: null } },
    });
  });

  it('collapses 403 and 422 into a generic rejection (never surfacing the secret)', async () => {
    stubFetch(403, { error: 'forbidden' });
    expect(await callForgeMigration(request())).toEqual({ ok: false, failure: { kind: 'rejected', status: 403 } });
    stubFetch(422, { error: 'invalid payload' });
    expect(await callForgeMigration(request())).toEqual({ ok: false, failure: { kind: 'rejected', status: 422 } });
  });

  it('keeps KaraBuddy’s own refusal out of the codes it reads off Forge', async () => {
    // `roster_too_large` is raised HERE, before the call — Forge has never sent
    // it and never will. The preview renders it like the others, but a body
    // claiming it would not be a state Forge is entitled to put us in.
    expect(isForgeBlockCode('seats_full')).toBe(true);
    expect(isForgeBlockCode('roster_too_large')).toBe(false);
    expect(isMigrationBlockCode('roster_too_large')).toBe(true);
    expect(isMigrationBlockCode('nonsense')).toBe(false);
    expect(FORGE_MAX_MEMBERS).toBe(500);

    stubFetch(409, { error: 'roster_too_large' });
    expect(await callForgeMigration(request())).toEqual({ ok: false, failure: { kind: 'rejected', status: 409 } });
  });

  it('does not invent a state for a 409 code it has never heard of', async () => {
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

  // 🔴 THE PRIMARY PATH: the first preview of a team that does not exist on
  // Forge yet. There is no id until the row is written and Forge refuses to
  // invent one, so both fields are null — and requiring strings here rejected
  // the one response this entire screen was built for.
  it('accepts the null forgeTeamId/teamUrl of a dry run that would CREATE the team', async () => {
    const dryCreate = plan({ outcome: 'created', forgeTeamId: null, teamUrl: null });
    stubFetch(200, dryCreate);
    expect(await callForgeMigration(request())).toEqual({ ok: true, plan: dryCreate });
  });

  it('still rejects a forgeTeamId/teamUrl that is neither a string nor null', async () => {
    stubFetch(200, plan({ forgeTeamId: 42 as unknown as string }));
    expect((await callForgeMigration(request())).ok).toBe(false);
    stubFetch(200, plan({ teamUrl: { href: 'x' } as unknown as string }));
    expect((await callForgeMigration(request())).ok).toBe(false);
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
