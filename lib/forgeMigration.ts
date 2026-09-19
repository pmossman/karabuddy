// KaraBuddy → SWU Forge team migration, sending side.
//
// One route, not two: the preview and the commit send an IDENTICAL payload to
// Forge's `POST /api/team-migration` and only `dryRun` differs. A separate
// "status" endpoint would be free to drift from the thing that actually writes,
// and the preview is the only place a human sees the roster before it crosses —
// it must not be able to lie. So everything the preview renders ("already
// offered", "declined", "new since") comes back from Forge, which owns the
// idempotency ledger. KaraBuddy deliberately stores NOTHING about migration
// state: a second source of truth for something Forge owns would drift.
//
// Ships dark. `forgeMigrationEnabled()` is false until BOTH env vars are set,
// so the settings card, the preview route and the API route are all invisible
// until the shared secret exists in Vercel.

export type ForgeRole = 'ADMIN' | 'EDITOR' | 'VIEWER';
export const FORGE_ROLES: readonly ForgeRole[] = ['ADMIN', 'EDITOR', 'VIEWER'] as const;

// What Forge reports it did (or would do) for each member. `joined` = matched an
// existing Forge user; `invited` = a TeamInvite at the handed role; the three
// `skipped_*` are the idempotency rules refusing to touch someone.
export type ForgeMemberAction =
  | 'joined'
  | 'invited'
  | 'skipped_already_offered'
  | 'skipped_declined'
  | 'skipped_existing_member';

export type ForgeOutcome = 'created' | 'updated' | 'noop';

export interface ForgeMigrationMemberInput {
  email: string;
  discordUserId: string | null;
  role: ForgeRole;
}

export interface ForgeMigrationRequest {
  sourceTeamId: string;
  teamName: string;
  dryRun: boolean;
  initiator: { email: string; discordUserId: string | null };
  members: ForgeMigrationMemberInput[];
}

export interface ForgeMigrationPlanMember {
  email: string;
  action: ForgeMemberAction;
  role: ForgeRole;
}

export interface ForgeMigrationPlan {
  outcome: ForgeOutcome;
  forgeTeamId: string;
  teamUrl: string;
  members: ForgeMigrationPlanMember[];
}

// Failures that are part of the design, not edge cases. `no_forge_account` is
// the only one the UI renders specifically — the rest collapse to one generic
// message so a bad or missing credential never reaches a browser.
export type ForgeFailure =
  | { kind: 'no_forge_account' }
  | { kind: 'rejected'; status: number }
  | { kind: 'unreachable'; detail: string }
  | { kind: 'bad_response'; detail: string };

export type ForgeCallResult = { ok: true; plan: ForgeMigrationPlan } | { ok: false; failure: ForgeFailure };

// Forge's own cap on Team.name.
export const FORGE_TEAM_NAME_MAX = 80;

// Outbound budget. Forge does real work on commit (team + membership rows +
// invite emails), so this is generous — but finite, so a hung Forge can't pin a
// KaraBuddy serverless function open for its whole timeout.
const FORGE_TIMEOUT_MS = 20_000;

export function forgeOrigin(): string {
  return (process.env.SWU_FORGE_ORIGIN || '').trim().replace(/\/+$/, '');
}

function migrationSecret(): string {
  return (process.env.TEAM_MIGRATION_SECRET || '').trim();
}

// The flag. Both halves must be present: an origin with no secret would 403 on
// every call, and a secret with no origin has nowhere to go.
export function forgeMigrationEnabled(): boolean {
  return !!forgeOrigin() && !!migrationSecret();
}

// Where we send an owner who has no Forge account yet. Auth.js on Forge is
// mounted at basePath `/auth`, so `/auth/signin` is its built-in provider page.
export function forgeSignInUrl(): string {
  const origin = forgeOrigin();
  return origin ? `${origin}/auth/signin` : '';
}

// The idempotency key Forge stores on its Team. Namespaced so Forge can tell a
// KaraBuddy team id apart from any other source it grows later — a bare 6-char
// slug is far too collidable to be a cross-system primary key.
export function sourceTeamId(teamSlug: string): string {
  return `kb_team_${teamSlug}`;
}

// KaraBuddy has two roles; Forge has four. The initiator is never in `members`
// (they are the `initiator` and become OWNER), a co-owner lands as ADMIN
// (ADMIN is what actually gates Forge's team settings), and everyone else
// defaults to EDITOR. VIEWER cannot build decks on Forge, which is wrong for a
// prep team — so it is never a default, only an override the owner picks per
// person in the preview.
export function defaultRoleFor(kbRole: string): ForgeRole {
  return kbRole === 'owner' ? 'ADMIN' : 'EDITOR';
}

export function isForgeRole(value: unknown): value is ForgeRole {
  return typeof value === 'string' && (FORGE_ROLES as readonly string[]).includes(value);
}

// Forge lowercases defensively too, but the contract says the CALLER lowercases
// — so the email we send is the email the ledger is keyed on, and the preview's
// join back onto our roster uses the same key.
export function normalizeEmail(email: string | null | undefined): string {
  return (email || '').trim().toLowerCase();
}

export function clampTeamName(raw: string): string {
  return raw.trim().slice(0, FORGE_TEAM_NAME_MAX);
}

function isPlanShape(value: unknown): value is ForgeMigrationPlan {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.outcome !== 'created' && v.outcome !== 'updated' && v.outcome !== 'noop') return false;
  if (typeof v.forgeTeamId !== 'string' || typeof v.teamUrl !== 'string') return false;
  if (!Array.isArray(v.members)) return false;
  return v.members.every(
    (m) => !!m && typeof m === 'object' && typeof (m as any).email === 'string' && typeof (m as any).action === 'string',
  );
}

// The single call. Same payload for preview and commit; `dryRun` is the only
// difference, and Forge runs every rule either way and writes nothing when it's
// true.
export async function callForgeMigration(payload: ForgeMigrationRequest): Promise<ForgeCallResult> {
  const origin = forgeOrigin();
  const secret = migrationSecret();
  if (!origin || !secret) {
    return { ok: false, failure: { kind: 'unreachable', detail: 'team migration is not configured' } };
  }

  let res: Response;
  try {
    res = await fetch(`${origin}/api/team-migration`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FORGE_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (e) {
    return { ok: false, failure: { kind: 'unreachable', detail: (e as Error)?.message || 'fetch failed' } };
  }

  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    // The one error the UI renders as its own state: a team needs an OWNER, and
    // an invitation cannot own anything — so the owner creates a Forge account
    // before we offer the move rather than after we half-create a team.
    const error = body && typeof body === 'object' ? (body as Record<string, unknown>).error : undefined;
    if (res.status === 409 && error === 'initiator_has_no_forge_account') {
      return { ok: false, failure: { kind: 'no_forge_account' } };
    }
    // 403 = bad/missing credential, 422 = payload rejected. Both are ours to
    // fix, not the owner's to read about, and neither may leak the secret.
    return { ok: false, failure: { kind: 'rejected', status: res.status } };
  }

  if (!isPlanShape(body)) {
    return { ok: false, failure: { kind: 'bad_response', detail: 'unrecognized response shape' } };
  }
  return { ok: true, plan: body };
}

// --- Plan summary (shared by the preview totals and the result banner) ---

export interface ForgePlanSummary {
  total: number;
  joined: number;
  invited: number;
  alreadyOffered: number;
  declined: number;
  existingMember: number;
  // What the confirm button would actually do. Zero = nothing to send.
  actionable: number;
}

export function summarizePlan(plan: ForgeMigrationPlan): ForgePlanSummary {
  const count = (action: ForgeMemberAction) => plan.members.filter((m) => m.action === action).length;
  const joined = count('joined');
  const invited = count('invited');
  return {
    total: plan.members.length,
    joined,
    invited,
    alreadyOffered: count('skipped_already_offered'),
    declined: count('skipped_declined'),
    existingMember: count('skipped_existing_member'),
    actionable: joined + invited,
  };
}

// `joined` and `invited` are the only actions that change anything, so they are
// the only rows whose role dropdown still means something. Everything else is
// Forge's now: rule 3 (an existing member's role is never changed) and rule 4
// (an email in the ledger is never re-invited) both say the preview cannot
// retroactively set a role, so the dropdown locks.
export function isRoleEditable(action: ForgeMemberAction): boolean {
  return action === 'joined' || action === 'invited';
}
