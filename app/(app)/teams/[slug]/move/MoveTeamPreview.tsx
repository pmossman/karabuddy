'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Panel } from '@/app/_components/Panel';
import { Select } from '@/app/_components/Select';
import { ErrorNote, Loading } from '@/app/_components/StatusUi';
import { glowButtonStyle } from '@/app/_components/glowButton';
import { btnGhost } from '@/app/_components/buttonStyles';
import { tokens } from '@/app/_theme/karabuddyTokens';
import {
  FORGE_TEAM_NAME_MAX,
  isRoleEditable,
  summarizePlan,
  type ForgeMemberAction,
  type ForgeMigrationPlan,
  type ForgeRole,
} from '@/lib/forgeMigration';

// The preview + confirm screen for the KaraBuddy → SWU Forge move.
//
// Mount calls our own route with `dryRun: true`; that route calls Forge with
// the SAME payload the commit will send, and we render the plan Forge returns.
// Nothing here is computed locally: "already offered", "declined" and the
// highlighted new-since rows are all read off `plan.members[].action`, because
// Forge owns the idempotency ledger and is the only side that knows them.
//
// Confirm re-sends the identical payload with `dryRun: false`.

interface RosterEntry {
  userId: string;
  name: string | null;
  image: string | null;
  email: string;
  kbRole: string;
  defaultRole: ForgeRole;
  hasDiscord: boolean;
}

interface MigrationResponse {
  ok: true;
  dryRun: boolean;
  teamName: string;
  plan: ForgeMigrationPlan;
  roster: RosterEntry[];
  excluded: { userId: string; name: string | null }[];
  initiator: { userId: string; name: string | null; email: string };
}

const ROLE_OPTIONS: ReadonlyArray<readonly [ForgeRole, string]> = [
  ['ADMIN', 'Admin'],
  ['EDITOR', 'Editor'],
  ['VIEWER', 'Viewer · no decks'],
];

// Forge's verdict per member, in the owner's language. `joined` and `invited`
// are the two that change anything; the rest are the idempotency rules refusing
// to touch someone, and their role dropdown locks accordingly.
const ACTION_TAG: Record<ForgeMemberAction, { label: string; fg: string; bg: string; title: string }> = {
  joined: {
    label: 'has account',
    fg: tokens.color.successText,
    bg: 'rgba(107, 217, 104, 0.12)',
    title: 'Already on SWU Forge — added to the team directly.',
  },
  invited: {
    label: 'will be invited',
    fg: tokens.color.warn,
    bg: 'rgba(224, 198, 74, 0.12)',
    title: 'No Forge account yet — gets an email invitation that binds on first sign-in.',
  },
  skipped_already_offered: {
    label: 'already offered',
    fg: tokens.color.textMuted,
    bg: 'rgba(255, 255, 255, 0.05)',
    title: 'Already offered a place on a previous move. Never asked twice.',
  },
  skipped_declined: {
    label: 'declined',
    fg: tokens.color.dangerSoft,
    bg: 'rgba(255, 122, 122, 0.1)',
    title: 'Declined their invitation. Deliberately not asked again.',
  },
  skipped_existing_member: {
    label: 'already a member',
    fg: tokens.color.accent,
    bg: tokens.color.primarySoft,
    title: 'Already on the Forge team — their role there is left exactly as it is.',
  },
};

const GRID = 'minmax(0, 1fr) 140px 160px';

export function MoveTeamPreview({ slug, initialTeamName }: { slug: string; initialTeamName: string }) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'no-account' | 'error' | 'sending' | 'done'>('loading');
  const [preview, setPreview] = useState<MigrationResponse | null>(null);
  const [result, setResult] = useState<MigrationResponse | null>(null);
  const [teamName, setTeamName] = useState(initialTeamName.slice(0, FORGE_TEAM_NAME_MAX));
  const [roles, setRoles] = useState<Record<string, ForgeRole>>({});
  const [error, setError] = useState<string | null>(null);
  const [signInUrl, setSignInUrl] = useState<string | null>(null);

  // The live values the send closure needs, without making it depend on them
  // (and without a stale-closure bug if the owner edits while a call is out).
  const nameRef = useRef(teamName);
  nameRef.current = teamName;
  const rolesRef = useRef(roles);
  rolesRef.current = roles;

  const call = useCallback(
    async (dryRun: boolean) => {
      setError(null);
      const res = await fetch(`/api/teams/${slug}/forge-migration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun, teamName: nameRef.current, roles: rolesRef.current }),
      });
      const body = await res.json().catch(() => ({} as Record<string, unknown>));
      return { res, body } as { res: Response; body: any };
    },
    [slug],
  );

  const runDryRun = useCallback(async () => {
    setPhase('loading');
    try {
      const { res, body } = await call(true);
      if (res.status === 409 && body?.error === 'initiator_has_no_forge_account') {
        setSignInUrl(typeof body.signInUrl === 'string' ? body.signInUrl : null);
        setPhase('no-account');
        return;
      }
      if (!res.ok || !body?.ok) {
        setError(messageFor(res.status));
        setPhase('error');
        return;
      }
      const data = body as MigrationResponse;
      setPreview(data);
      // Seed the dropdowns from the defaults the server applied, so what the
      // owner sees is exactly what the dry run was computed against.
      setRoles((prev) => {
        const next = { ...prev };
        for (const r of data.roster) if (!next[r.userId]) next[r.userId] = r.defaultRole;
        return next;
      });
      setPhase('ready');
    } catch (e) {
      setError((e as Error)?.message || 'network error');
      setPhase('error');
    }
  }, [call]);

  useEffect(() => {
    void runDryRun();
  }, [runDryRun]);

  const confirm = useCallback(async () => {
    setPhase('sending');
    try {
      const { res, body } = await call(false);
      if (res.status === 409 && body?.error === 'initiator_has_no_forge_account') {
        setSignInUrl(typeof body.signInUrl === 'string' ? body.signInUrl : null);
        setPhase('no-account');
        return;
      }
      if (!res.ok || !body?.ok) {
        setError(messageFor(res.status));
        setPhase('ready');
        return;
      }
      setResult(body as MigrationResponse);
      setPhase('done');
    } catch (e) {
      setError((e as Error)?.message || 'network error');
      setPhase('ready');
    }
  }, [call]);

  if (phase === 'loading') {
    return (
      <Panel>
        {/* The dry run — Forge runs every idempotency rule and writes nothing. */}
        <Loading label="what this move would do, from SWU Forge" />
      </Panel>
    );
  }

  if (phase === 'no-account') {
    return <NoForgeAccount signInUrl={signInUrl} slug={slug} onRecheck={runDryRun} />;
  }

  if (phase === 'error' || !preview) {
    return (
      <Panel style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Couldn&apos;t reach SWU Forge</div>
        <ErrorNote>{error}</ErrorNote>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={runDryRun} style={btnGhost}>
            Try again
          </button>
          <Link href={`/teams/${slug}?tab=settings`} style={{ ...btnGhost, textDecoration: 'none' }}>
            Back to settings
          </Link>
        </div>
      </Panel>
    );
  }

  if (phase === 'done' && result) {
    return <MoveResult slug={slug} data={result} />;
  }

  return (
    <MoveForm
      slug={slug}
      data={preview}
      teamName={teamName}
      setTeamName={setTeamName}
      roles={roles}
      setRoles={setRoles}
      onConfirm={confirm}
      sending={phase === 'sending'}
      error={error}
    />
  );
}

function messageFor(status: number): string {
  if (status === 502) return 'SWU Forge did not accept the request. Nothing was sent — try again in a minute.';
  if (status === 403) return 'Only a team owner can move this team.';
  if (status === 404) return 'Moving teams to SWU Forge is not switched on yet.';
  return `Something went wrong (${status}).`;
}

// --- The preview form ---

function MoveForm({
  slug,
  data,
  teamName,
  setTeamName,
  roles,
  setRoles,
  onConfirm,
  sending,
  error,
}: {
  slug: string;
  data: MigrationResponse;
  teamName: string;
  setTeamName: (v: string) => void;
  roles: Record<string, ForgeRole>;
  setRoles: (fn: (prev: Record<string, ForgeRole>) => Record<string, ForgeRole>) => void;
  onConfirm: () => void;
  sending: boolean;
  error: string | null;
}) {
  const summary = useMemo(() => summarizePlan(data.plan), [data.plan]);

  // Forge keys its plan on the lowercased email; our roster keys on userId. The
  // email is the join, exactly as the contract says.
  const byEmail = useMemo(() => {
    const m = new Map<string, ForgeMemberAction>();
    for (const p of data.plan.members) m.set(p.email.toLowerCase(), p.action);
    return m;
  }, [data.plan]);

  // A second press only ever adds people. On a re-run, the rows Forge is still
  // willing to act on ARE the ones who are new since last time — so we can
  // highlight them without KaraBuddy tracking anything itself.
  const isRerun = data.plan.outcome !== 'created';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 860 }}>
      <Panel style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: tokens.color.text }}>Team name on SWU Forge</div>
          <input
            data-testid="forge-team-name"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            maxLength={FORGE_TEAM_NAME_MAX}
            aria-label="Team name on SWU Forge"
            style={{
              display: 'block',
              width: '100%',
              marginTop: 8,
              background: tokens.color.bg,
              color: tokens.color.text,
              border: `1px solid ${tokens.color.border}`,
              borderRadius: tokens.radius.md,
              padding: '8px 10px',
              fontSize: 14,
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />
          <p style={{ margin: '6px 0 0', fontSize: 11.5, color: tokens.color.textMuted }}>
            SWU Forge allows {FORGE_TEAM_NAME_MAX} characters ({teamName.trim().length}/{FORGE_TEAM_NAME_MAX}).
            {isRerun && ' This team already exists on Forge, so the name there is left as it is.'}
          </p>
        </div>

        <MemberTable
          data={data}
          byEmail={byEmail}
          roles={roles}
          setRoles={setRoles}
          highlightActionable={isRerun}
        />

        <Totals summary={summary} />

        <ErrorNote>{error}</ErrorNote>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <Link href={`/teams/${slug}?tab=settings`} style={{ ...btnGhost, textDecoration: 'none' }}>
            Cancel
          </Link>
          <button
            type="button"
            data-testid="forge-confirm"
            onClick={onConfirm}
            disabled={sending || summary.actionable === 0 || !teamName.trim()}
            style={{
              ...glowButtonStyle,
              opacity: sending || summary.actionable === 0 || !teamName.trim() ? 0.5 : 1,
              cursor: sending || summary.actionable === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {sending
              ? 'Sending…'
              : summary.actionable === 0
                ? 'Nothing new to send'
                : `Send ${summary.actionable} invitation${summary.actionable === 1 ? '' : 's'}`}
          </button>
        </div>
      </Panel>

      <p style={{ margin: 0, fontSize: 12, color: tokens.color.textMuted, lineHeight: 1.6, maxWidth: 640 }}>
        Nothing has left KaraBuddy yet. Decks, replays, stats and the Discord bot install do not come along —
        only the team and its people. Your KaraBuddy team keeps working exactly as it does now.
      </p>
    </div>
  );
}

function MemberTable({
  data,
  byEmail,
  roles,
  setRoles,
  highlightActionable,
}: {
  data: MigrationResponse;
  byEmail: Map<string, ForgeMemberAction>;
  roles: Record<string, ForgeRole>;
  setRoles: (fn: (prev: Record<string, ForgeRole>) => Record<string, ForgeRole>) => void;
  highlightActionable: boolean;
}) {
  return (
    <div style={{ border: `1px solid ${tokens.surface.panelBorder}`, borderRadius: tokens.radius.md, overflow: 'hidden' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: GRID,
          gap: 12,
          padding: '8px 14px',
          background: 'rgba(0,0,0,0.22)',
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: tokens.color.textMuted,
        }}
      >
        <span>Member</span>
        <span>On Forge</span>
        <span>Role</span>
      </div>

      {/* The initiator is not in `members` — they are the payload's `initiator`
          and become the Forge team's OWNER. A team needs an owner, and an
          invitation can't own anything, so this row is never editable. */}
      <Row
        name={data.initiator.name}
        email={data.initiator.email}
        tag={<Tag label="you" fg={tokens.color.accent} bg={tokens.color.primarySoft} title="You create and own the Forge team." />}
        roleCell={<LockedRole role="OWNER" title="A team needs an owner, and an invitation can't own anything." />}
      />

      {data.roster.map((m) => {
        const action = byEmail.get(m.email);
        const tagInfo = action ? ACTION_TAG[action] : null;
        const editable = !!action && isRoleEditable(action);
        const fresh = highlightActionable && editable;
        return (
          <Row
            key={m.userId}
            name={m.name}
            email={m.email}
            background={fresh ? 'rgba(107, 217, 104, 0.07)' : undefined}
            dim={!!action && !editable}
            tag={
              fresh ? (
                <Tag
                  label="new since"
                  fg={tokens.color.successText}
                  bg="rgba(107, 217, 104, 0.12)"
                  title="Joined KaraBuddy since the last move — this is what a second press adds."
                />
              ) : tagInfo ? (
                <Tag label={tagInfo.label} fg={tagInfo.fg} bg={tagInfo.bg} title={tagInfo.title} />
              ) : (
                <span style={{ fontSize: 11, color: tokens.color.textMuted }}>—</span>
              )
            }
            roleCell={
              editable ? (
                <Select<ForgeRole>
                  value={roles[m.userId] ?? m.defaultRole}
                  onChange={(v) => setRoles((prev) => ({ ...prev, [m.userId]: v }))}
                  options={ROLE_OPTIONS}
                  ariaLabel={`Role for ${m.name || m.email}`}
                  testId={`forge-role-${m.userId}`}
                  style={{ width: '100%', maxWidth: '100%' }}
                />
              ) : (
                <LockedRole
                  role={roles[m.userId] ?? m.defaultRole}
                  title="Forge already has a decision for this person — the migration never overwrites one."
                />
              )
            }
          />
        );
      })}

      {/* Every KaraBuddy account came from an OAuth email, so this is rare — but
          Forge identifies people by lowercased email, so a member without one
          can't be matched or invited. Named rather than silently dropped. */}
      {data.excluded.map((m) => (
        <Row
          key={m.userId}
          name={m.name}
          email="no email on file"
          dim
          tag={<Tag label="can't move" fg={tokens.color.dangerSoft} bg="rgba(255, 122, 122, 0.1)" title="SWU Forge identifies people by email address." />}
          roleCell={<span style={{ fontSize: 11.5, color: tokens.color.textMuted }}>—</span>}
        />
      ))}
    </div>
  );
}

function Row({
  name,
  email,
  tag,
  roleCell,
  background,
  dim,
}: {
  name: string | null;
  email: string;
  tag: React.ReactNode;
  roleCell: React.ReactNode;
  background?: string;
  dim?: boolean;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: GRID,
        gap: 12,
        alignItems: 'center',
        padding: '9px 14px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        background,
        opacity: dim ? 0.62 : 1,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: tokens.color.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name || email}
        </div>
        <div
          style={{
            fontSize: 11,
            color: tokens.color.textMuted,
            fontFamily: tokens.led.mono,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {email}
        </div>
      </div>
      <div>{tag}</div>
      <div>{roleCell}</div>
    </div>
  );
}

function Tag({ label, fg, bg, title }: { label: string; fg: string; bg: string; title: string }) {
  return (
    <span
      title={title}
      style={{
        display: 'inline-block',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        padding: '3px 7px',
        borderRadius: tokens.radius.sm,
        color: fg,
        background: bg,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

function LockedRole({ role, title }: { role: string; title: string }) {
  return (
    <span title={title} style={{ fontSize: 11.5, color: tokens.color.textMuted, fontFamily: tokens.led.mono }}>
      {role} 🔒
    </span>
  );
}

function Totals({ summary }: { summary: ReturnType<typeof summarizePlan> }) {
  const parts: { n: number; label: string }[] = [
    { n: summary.total, label: summary.total === 1 ? 'member' : 'members' },
  ];
  if (summary.joined) {
    parts.push({
      n: summary.joined,
      label: summary.joined === 1 ? 'already has a Forge account' : 'already have Forge accounts',
    });
  }
  if (summary.invited) parts.push({ n: summary.invited, label: 'will be invited by email' });
  if (summary.existingMember) parts.push({ n: summary.existingMember, label: 'already on the Forge team' });
  if (summary.alreadyOffered) parts.push({ n: summary.alreadyOffered, label: 'already offered — skipped' });
  if (summary.declined) parts.push({ n: summary.declined, label: 'declined — not asked again' });
  // A second press with nothing to do should say so, not show a row of zeroes.
  if (summary.actionable === 0) parts.push({ n: 0, label: 'new to add' });

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 18,
        paddingTop: 12,
        borderTop: '1px solid rgba(255,255,255,0.08)',
        fontSize: 12.5,
        color: tokens.color.textSecondary,
      }}
    >
      {parts.map((p) => (
        <span key={p.label}>
          <strong style={{ color: tokens.color.text, fontVariantNumeric: 'tabular-nums' }}>{p.n}</strong> {p.label}
        </span>
      ))}
    </div>
  );
}

// --- The two terminal states ---

function NoForgeAccount({ signInUrl, slug, onRecheck }: { signInUrl: string | null; slug: string; onRecheck: () => void }) {
  return (
    <Panel style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 680 }}>
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
          padding: '14px 16px',
          borderRadius: tokens.radius.md,
          background: 'rgba(255, 122, 122, 0.08)',
          border: '1px solid rgba(255, 122, 122, 0.3)',
        }}
      >
        <span style={{ fontSize: 17, lineHeight: 1.3 }} aria-hidden>
          ✋
        </span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#ffd0d0' }}>You need an SWU Forge account first</div>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, color: tokens.color.textSecondary, lineHeight: 1.55 }}>
            A team needs an owner, and an invitation can&apos;t own anything — so we check before offering the
            move rather than creating a half-owned team. Sign in to SWU Forge once with the same email or
            Discord account, then come back.
          </p>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {signInUrl && (
          <a href={signInUrl} target="_blank" rel="noopener noreferrer" data-testid="forge-signup" style={glowButtonStyle}>
            Create your Forge account →
          </a>
        )}
        <button type="button" onClick={onRecheck} style={btnGhost}>
          I&apos;ve done that — check again
        </button>
        <Link href={`/teams/${slug}?tab=settings`} style={{ ...btnGhost, textDecoration: 'none' }}>
          Back to settings
        </Link>
      </div>
    </Panel>
  );
}

function MoveResult({ slug, data }: { slug: string; data: MigrationResponse }) {
  const summary = summarizePlan(data.plan);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 720 }}>
      <Panel accent style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start',
            padding: '14px 16px',
            borderRadius: tokens.radius.md,
            background: 'rgba(107, 217, 104, 0.09)',
            border: '1px solid rgba(107, 217, 104, 0.35)',
          }}
        >
          <span style={{ fontSize: 17, lineHeight: 1.3 }} aria-hidden>
            ✓
          </span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: tokens.color.text }} data-testid="forge-result-heading">
              {data.teamName} is on SWU Forge
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 12.5, color: tokens.color.textSecondary, lineHeight: 1.55 }}>
              <strong style={{ color: tokens.color.text }}>{summary.joined}</strong> added straight away (they already
              had Forge accounts) · <strong style={{ color: tokens.color.text }}>{summary.invited}</strong> invited by
              email — they join on first sign-in
              {summary.alreadyOffered > 0 && <> · {summary.alreadyOffered} already offered, not asked again</>}
              {summary.declined > 0 && <> · {summary.declined} declined, not asked again</>}
              {summary.existingMember > 0 && <> · {summary.existingMember} already on the team</>}.
            </p>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            background: tokens.color.bgDeep,
            border: `1px solid ${tokens.color.border}`,
            borderRadius: tokens.radius.md,
            padding: '9px 12px',
            fontFamily: tokens.led.mono,
            fontSize: 12,
            color: tokens.color.textSecondary,
            overflowWrap: 'anywhere',
          }}
        >
          <span>{data.plan.teamUrl}</span>
          <a
            href={data.plan.teamUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="forge-team-link"
            style={{ ...btnGhost, marginLeft: 'auto', textDecoration: 'none', fontFamily: 'inherit' }}
          >
            Open on Forge →
          </a>
        </div>

        <p style={{ margin: 0, fontSize: 12.5, color: tokens.color.textSecondary, lineHeight: 1.55 }}>
          Your KaraBuddy team is unchanged — not archived, not locked, not deleted. Press{' '}
          <strong style={{ color: tokens.color.text }}>Move team</strong> again later to invite anyone who joins
          after today; nobody is ever asked twice.
        </p>

        <div>
          <Link href={`/teams/${slug}?tab=settings`} style={{ ...btnGhost, textDecoration: 'none' }}>
            Back to settings
          </Link>
        </div>
      </Panel>
    </div>
  );
}
