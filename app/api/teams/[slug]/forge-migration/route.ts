import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { accounts, teamMembers, teams, users } from '@/lib/schema';
import {
  callForgeMigration,
  clampTeamName,
  defaultRoleFor,
  FORGE_MAX_MEMBERS,
  forgeMigrationEnabled,
  isForgeRole,
  normalizeEmail,
  sourceTeamId,
  type ForgeMigrationMemberInput,
  type ForgeRole,
} from '@/lib/forgeMigration';

export const runtime = 'nodejs';

// KaraBuddy → SWU Forge team migration, sending side. Owner-only.
//
// ONE route for both the preview and the commit, mirroring the contract's "one
// route, not two": the body carries `dryRun` and nothing else differs. The
// preview is the only place a human sees the roster before it crosses, so it
// must be produced by the exact call that writes.
//
// The browser NEVER supplies emails or Discord ids — it sends only `dryRun`,
// the edited team name, and a role per KaraBuddy userId. The roster is read
// from the DB here, so a member can't be added, renamed or re-keyed from the
// client. `TEAM_MIGRATION_SECRET` likewise never leaves the server; a 403 from
// Forge collapses into a generic failure so the credential is never surfaced.
//
// Nothing about migration state is recorded in KaraBuddy: the idempotency
// ledger lives on Forge, and a second copy here would drift.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // Ships dark — indistinguishable from "no such route" until the shared
  // secret is set. That secret is the ONLY environment variable this feature
  // has; the Forge origin is a constant. Past this, the boundary is
  // owners-only, checked below against the team's own roster.
  if (!forgeMigrationEnabled()) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  }

  const db = getDb();
  const [team] = await db.select().from(teams).where(eq(teams.slug, slug)).limit(1);
  if (!team) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  const [me] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamSlug, slug), eq(teamMembers.userId, userId)))
    .limit(1);
  if (!me || me.role !== 'owner') {
    return NextResponse.json({ ok: false, error: 'owner only' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const dryRun = (body as Record<string, unknown>).dryRun !== false;
  const rawRoles = (body as Record<string, unknown>).roles;
  const roleOverrides: Record<string, ForgeRole> = {};
  if (rawRoles && typeof rawRoles === 'object' && !Array.isArray(rawRoles)) {
    for (const [id, role] of Object.entries(rawRoles as Record<string, unknown>)) {
      if (isForgeRole(role)) roleOverrides[id] = role;
    }
  }

  // The name Forge will store. Forge applies it on CREATE only (a team renamed
  // on Forge keeps its name), but we still send it every time — the payload is
  // identical between dry run and commit by design.
  const requestedName = typeof (body as Record<string, unknown>).teamName === 'string'
    ? clampTeamName((body as Record<string, unknown>).teamName as string)
    : clampTeamName(team.name);
  if (!requestedName) {
    return NextResponse.json({ ok: false, error: 'team name required' }, { status: 400 });
  }

  // Roster straight from the DB, with each member's Discord id where sign-in
  // left one (accounts.providerAccountId, provider='discord') — the strong
  // match key. A Google-only member has no row and matches on email alone.
  const rows = await db
    .select({
      userId: teamMembers.userId,
      kbRole: teamMembers.role,
      joinedAt: teamMembers.joinedAt,
      name: users.name,
      email: users.email,
      image: users.image,
      discordUserId: accounts.providerAccountId,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .leftJoin(accounts, and(eq(accounts.userId, teamMembers.userId), eq(accounts.provider, 'discord')))
    .where(eq(teamMembers.teamSlug, slug))
    .orderBy(teamMembers.joinedAt);

  const initiatorRow = rows.find((r) => r.userId === userId);
  const initiatorEmail = normalizeEmail(initiatorRow?.email);
  if (!initiatorEmail) {
    // Every KaraBuddy account came from a Google/Discord OAuth email, so this is
    // a data anomaly rather than a flow. Fail loudly rather than sending a
    // payload Forge can only reject.
    return NextResponse.json({ ok: false, error: 'initiator_has_no_email' }, { status: 409 });
  }

  const roster = rows
    .filter((r) => r.userId !== userId)
    .map((r) => ({
      userId: r.userId,
      name: r.name,
      image: r.image,
      email: normalizeEmail(r.email),
      discordUserId: r.discordUserId ?? null,
      kbRole: r.kbRole,
      defaultRole: defaultRoleFor(r.kbRole),
      role: roleOverrides[r.userId] ?? defaultRoleFor(r.kbRole),
    }));

  // Who can actually cross, and who is named in the preview instead.
  //
  // ⚠ Both exclusions exist because Forge's identity key is the lowercased
  // email and nothing else. A member without one cannot be matched or invited;
  // two KaraBuddy accounts that lowercase to the SAME address are one person to
  // Forge, and sending both is a 422 for the whole payload — which would reach
  // the owner as "SWU Forge did not accept the request" over a fact they can
  // see. (Reachable today: `users.email` is unique, but Postgres uniqueness is
  // case-sensitive, so `Ana@e.com` and `ana@e.com` are two rows and one person.)
  //
  // ⛔ Neither is dropped silently — the preview names them and says why.
  const migratable: typeof roster = [];
  const excluded: { userId: string; name: string | null; email: string | null; reason: 'no_email' | 'duplicate_email' }[] = [];
  const seenEmails = new Set<string>();
  for (const r of roster) {
    if (!r.email) {
      excluded.push({ userId: r.userId, name: r.name, email: null, reason: 'no_email' });
      continue;
    }
    if (seenEmails.has(r.email)) {
      // The earlier member wins — `rows` is ordered by joinedAt, so the account
      // that has been on the team longest is the one that moves.
      excluded.push({ userId: r.userId, name: r.name, email: r.email, reason: 'duplicate_email' });
      continue;
    }
    seenEmails.add(r.email);
    migratable.push(r);
  }

  const members: ForgeMigrationMemberInput[] = migratable.map((r) => ({
    email: r.email,
    discordUserId: r.discordUserId,
    role: r.role,
  }));

  // Forge's own ceiling on members[]. Checked here so an oversized roster is a
  // sentence about this team rather than a generic failure about the request.
  if (members.length > FORGE_MAX_MEMBERS) {
    return NextResponse.json(
      { ok: false, error: 'roster_too_large', cap: FORGE_MAX_MEMBERS, requested: members.length },
      { status: 409 },
    );
  }

  const result = await callForgeMigration({
    sourceTeamId: sourceTeamId(slug),
    teamName: requestedName,
    dryRun,
    initiator: { email: initiatorEmail, discordUserId: initiatorRow?.discordUserId ?? null },
    members,
  });

  if (!result.ok) {
    const { failure } = result;
    // Forge's designed refusals, forwarded with Forge's own vocabulary and
    // Forge's own numbers. Each is a state the preview renders in full: they all
    // name something the owner has to go and do, and every one of them is
    // reachable on the DRY RUN — which is the point, because nothing has been
    // written when they see it.
    //
    // `signInUrl` is the one Forge returned (amendment 3); KaraBuddy no longer
    // derives it. `cap` / `used` / `requested` are Forge's caps, not ours.
    if (failure.kind === 'blocked') {
      const { code, signInUrl, cap, used, requested } = failure.block;
      return NextResponse.json(
        {
          ok: false,
          error: code,
          ...(signInUrl ? { signInUrl } : {}),
          ...(cap !== null ? { cap } : {}),
          ...(used !== null ? { used } : {}),
          ...(requested !== null ? { requested } : {}),
        },
        { status: 409 },
      );
    }
    // Everything else is a generic failure to the owner and a log line for us.
    // Never echo Forge's status or body — 403 means our credential is wrong.
    console.error(
      `[karabuddy] forge migration ${dryRun ? 'dry run' : 'commit'} failed for team ${slug}: ` +
        `${failure.kind}${'status' in failure ? ` (${failure.status})` : ''}` +
        `${'detail' in failure ? ` ${failure.detail}` : ''}`,
    );
    return NextResponse.json({ ok: false, error: 'forge_unavailable' }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    teamName: requestedName,
    plan: result.plan,
    roster: migratable.map((r) => ({
      userId: r.userId,
      name: r.name,
      image: r.image,
      email: r.email,
      kbRole: r.kbRole,
      defaultRole: r.defaultRole,
      hasDiscord: !!r.discordUserId,
    })),
    excluded,
    initiator: { userId, name: initiatorRow?.name ?? null, email: initiatorEmail },
  });
}
