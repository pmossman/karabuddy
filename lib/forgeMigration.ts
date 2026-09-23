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
// Ships dark. ⭐ ONE environment variable runs this whole feature:
// TEAM_MIGRATION_SECRET, the credential Forge authenticates us with. It is also
// the flag — until it is set, the settings card, the preview route and the API
// route are all invisible. What protects the move once it IS set is that both
// server entrances are owners-only.
//
// ⛔ Resist adding a second variable. An on/off flag beside the secret is a
// switch that does nothing the secret does not already do, and an origin pin
// on either side is a stop on browser calls that a server-only bearer secret
// already makes impossible.

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

// ⚠ `forgeTeamId` and `teamUrl` are NULL on the primary path: a dry run for a
// team that does not exist on Forge yet. There is no id until the row is
// written, and Forge refuses to invent one — a preview that showed a team URL
// nobody could open would be the preview lying, which is the single thing this
// whole one-route shape exists to prevent. They are non-null on any dry run for
// a team that already moved, and on every commit.
export interface ForgeMigrationPlan {
  outcome: ForgeOutcome;
  forgeTeamId: string | null;
  teamUrl: string | null;
  members: ForgeMigrationPlanMember[];
}

// The 409s Forge answers with. Every one of them is reachable ON A DRY RUN by
// design — the preview is where a human is supposed to see them, while nothing
// has been written yet — so every one of them gets its own state in the UI.
// ⛔ Do not collapse these into one "couldn't move the team": each names a
// different thing the owner has to go and do, and a generic failure hides
// exactly the fact they need. `rejected` stays generic on purpose (403 = our
// credential, 422 = our payload — neither is the owner's to read about).
export type ForgeBlockCode =
  | 'initiator_has_no_forge_account'
  | 'initiator_has_no_profile'
  | 'initiator_not_team_admin'
  | 'seats_full'
  | 'team_cap_reached';

export const FORGE_BLOCK_CODES: readonly ForgeBlockCode[] = [
  'initiator_has_no_forge_account',
  'initiator_has_no_profile',
  'initiator_not_team_admin',
  'seats_full',
  'team_cap_reached',
] as const;

export function isForgeBlockCode(value: unknown): value is ForgeBlockCode {
  return typeof value === 'string' && (FORGE_BLOCK_CODES as readonly string[]).includes(value);
}

// KaraBuddy's OWN refusal, raised before the call rather than read off a
// response. Forge 422s a roster over its cap, and a 422 is by design a generic
// failure here — right for a payload shape we got wrong, wrong for a fact about
// this team that the owner can see and act on. So we check it ourselves and say
// the real number.
export type CallerBlockCode = 'roster_too_large';

export type MigrationBlockCode = ForgeBlockCode | CallerBlockCode;

export function isMigrationBlockCode(value: unknown): value is MigrationBlockCode {
  return isForgeBlockCode(value) || value === 'roster_too_large';
}

// Forge's own ceiling on members[] (its MAX_MEMBERS). ⚠ A roster over it is a
// 422, which would reach the owner as "SWU Forge did not accept the request".
export const FORGE_MAX_MEMBERS = 500;

// What the UI needs to render each refusal, carried straight through from
// Forge's body. The numbers are Forge's ("teams hold 25 and this roster needs
// 31"), never ours — a cap KaraBuddy hardcoded would be wrong the day Forge
// changed it, and silently.
export interface MigrationBlock {
  code: MigrationBlockCode;
  // 🔒 Amendment 3: Forge OWNS its sign-in URL and returns it. Null only if a
  // Forge old enough to omit it answers — we show the state without the button
  // rather than sending anyone to a URL we made up.
  signInUrl: string | null;
  cap: number | null;
  used: number | null;
  requested: number | null;
}

// Failures that are part of the design, not edge cases.
export type ForgeFailure =
  | { kind: 'blocked'; block: MigrationBlock }
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

// Where SWU Forge lives. ⭐ A CONSTANT, not configuration: Forge's origin is
// neither secret nor variable, and production needs nobody to set it. The
// SWU_FORGE_ORIGIN override exists ONLY so local development can point at a
// Forge dev server (and so the end-to-end lab can); unset or empty in
// production is the correct, working state.
const FORGE_ORIGIN = 'https://swuforge.com';

export function forgeOrigin(): string {
  const override = (process.env.SWU_FORGE_ORIGIN || '').trim().replace(/\/+$/, '');
  return override || FORGE_ORIGIN;
}

function migrationSecret(): string {
  return (process.env.TEAM_MIGRATION_SECRET || '').trim();
}

// The flag, and the credential, and the only variable this feature needs. ⭐ No
// secret means no call KaraBuddy could make that Forge would not 403, so there
// is nothing to show — and "off" is the default rather than a second switch
// somebody has to remember to leave alone.
export function forgeMigrationEnabled(): boolean {
  return !!migrationSecret();
}

// ⛔ There is deliberately no forgeSignInUrl() here. Forge's sign-in URL is
// Forge's to know: it comes back in the 409 body (amendment 3). Deriving it
// from SWU_FORGE_ORIGIN meant guessing that Auth.js is mounted at `/auth` and
// that `pages.signIn` is unset — one refactor on the other side from sending
// every owner to a 404, with nothing here able to notice.

// ⛔ There is deliberately no callerOrigin() here either, and the call below
// sets no `Origin` header. Forge used to pin the caller's origin; it was
// removed on both sides. An origin pin stops calls made from a BROWSER, and a
// browser cannot hold a server-only bearer secret in the first place — while
// anyone who does hold the secret can set any header they please, so it was
// never a defence against a leaked credential. What it did do was 403 every
// real call the moment the two lists disagreed.

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

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isPlanShape(value: unknown): value is ForgeMigrationPlan {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.outcome !== 'created' && v.outcome !== 'updated' && v.outcome !== 'noop') return false;
  // ⚠ null, not a string, whenever the team does not exist on Forge yet — which
  // is the FIRST preview of every move, i.e. the primary path. Requiring a
  // string here rejected the one response this screen is built for.
  if (!isStringOrNull(v.forgeTeamId) || !isStringOrNull(v.teamUrl)) return false;
  if (!Array.isArray(v.members)) return false;
  return v.members.every(
    (m) => !!m && typeof m === 'object' && typeof (m as any).email === 'string' && typeof (m as any).action === 'string',
  );
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// The single call. Same payload for preview and commit; `dryRun` is the only
// difference, and Forge runs every rule either way and writes nothing when it's
// true.
export async function callForgeMigration(payload: ForgeMigrationRequest): Promise<ForgeCallResult> {
  const origin = forgeOrigin();
  const secret = migrationSecret();
  // ⭐ Only the secret can be missing — `forgeOrigin()` is a constant with a
  // dev-only override and always answers something.
  if (!secret) {
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
    // The 409s are the designed refusals, and each gets its own screen. They are
    // reachable on a dry run precisely so the owner meets them in the preview,
    // before anything has been written.
    const fields = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    if (res.status === 409 && isForgeBlockCode(fields.error)) {
      return {
        ok: false,
        failure: {
          kind: 'blocked',
          block: {
            code: fields.error,
            signInUrl: typeof fields.signInUrl === 'string' ? fields.signInUrl : null,
            cap: numberOrNull(fields.cap),
            used: numberOrNull(fields.used),
            requested: numberOrNull(fields.requested),
          },
        },
      };
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
