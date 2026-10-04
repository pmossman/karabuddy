'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Select } from '@/app/_components/Select';
import { ErrorNote, Loading } from '@/app/_components/StatusUi';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { forgeButton } from './ForgeAnnouncementBody';
import {
  FORGE_TEAM_NAME_MAX,
  forgeTeamName,
  isMigrationBlockCode,
  rosterRole,
  summarizePlan,
  type MigrationBlock,
  type ForgeMemberAction,
  type ForgeMigrationPlan,
  type ForgeMigrationPlanMember,
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
  excluded: { userId: string; name: string | null; email: string | null; reason: 'no_email' | 'duplicate_email' }[];
  initiator: { userId: string; name: string | null; email: string };
}

const f = tokens.forge;

const ROLE_OPTIONS: ReadonlyArray<readonly [ForgeRole, string]> = [
  ['ADMIN', 'Admin'],
  ['EDITOR', 'Editor'],
  ['VIEWER', 'Viewer · no decks'],
];

// Forge's verdict per member, in the owner's language. `joined` and `invited`
// are the two that change anything (and only an older Forge still sends
// `joined`); the rest are the idempotency rules refusing to touch someone, and
// their role dropdown locks accordingly.
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
    title: 'Gets an email invitation, and joins the Forge team on accepting it.',
  },
  skipped_already_offered: {
    label: 'already offered',
    fg: f.textMuted,
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
    fg: f.softText,
    bg: f.softBg,
    title: 'Already on the Forge team — their role there is left exactly as it is.',
  },
};

const moveStyles = `
  .kbf-move { container-type: inline-size; font-family: ${f.font}; color: ${f.text}; }
  .kbf-move-row { display: grid; grid-template-columns: minmax(0, 1fr) 140px 160px; gap: 12px; align-items: center; padding: 10px 14px; }
  .kbf-move-name:focus { border-color: ${f.softText} !important; }
  @container (max-width: 560px) {
    .kbf-move-row { grid-template-columns: minmax(0, 1fr) 128px; gap: 6px 12px; }
    .kbf-move-row > :nth-child(2) { grid-row: 2; grid-column: 1; }
    .kbf-move-row > :nth-child(3) { grid-row: 1 / span 2; grid-column: 2; }
    .kbf-move-head > :nth-child(2) { display: none; }
  }
`;

const note: CSSProperties = { margin: 0, fontSize: 13, lineHeight: 1.55, color: f.textMuted };
const quietLink: CSSProperties = { color: f.softText, textDecoration: 'none', fontFamily: tokens.led.mono };

export function MoveTeamPreview({ slug, initialTeamName, onCancel }: { slug: string; initialTeamName: string; onCancel: () => void }) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'blocked' | 'error' | 'sending' | 'done'>('loading');
  const [preview, setPreview] = useState<MigrationResponse | null>(null);
  const [result, setResult] = useState<MigrationResponse | null>(null);
  const [teamName, setTeamName] = useState(initialTeamName.slice(0, FORGE_TEAM_NAME_MAX));
  const [roles, setRoles] = useState<Record<string, ForgeRole>>({});
  const [error, setError] = useState<string | null>(null);
  // Forge's designed refusals. Each renders as its own screen, because each
  // names a different thing the owner has to go and do — and all of them come
  // back from the DRY RUN, before anything has been written.
  const [block, setBlock] = useState<MigrationBlock | null>(null);

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
      const blocked = blockFrom(res.status, body);
      if (blocked) {
        setBlock(blocked);
        setPhase('blocked');
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
      // A refusal can arrive on the commit too — someone filled the last seat,
      // or the owner lost their Forge admin role, between the preview and the
      // press. Same screens, and nothing was written.
      const blocked = blockFrom(res.status, body);
      if (blocked) {
        setBlock(blocked);
        setPhase('blocked');
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
      <Shell>
        {/* The dry run — Forge runs every idempotency rule and writes nothing. */}
        <Loading label="what this move would do, from SWU Forge" style={{ fontSize: 14, color: f.textMuted }} />
      </Shell>
    );
  }

  if (phase === 'blocked' && block) {
    return (
      <Shell>
        <MoveBlocked block={block} onRecheck={runDryRun} />
      </Shell>
    );
  }

  if (phase === 'error' || !preview) {
    return (
      <Shell>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Couldn&apos;t reach SWU Forge</div>
          <ErrorNote style={{ fontSize: 13 }}>{error}</ErrorNote>
          <button type="button" onClick={runDryRun} className="kbf-soft" style={forgeButton}>
            Try again
          </button>
        </div>
      </Shell>
    );
  }

  if (phase === 'done' && result) {
    return (
      <Shell>
        <MoveResult data={result} />
      </Shell>
    );
  }

  return (
    <Shell>
      <MoveForm
        data={preview}
        teamName={teamName}
        setTeamName={setTeamName}
        roles={roles}
        setRoles={setRoles}
        onConfirm={confirm}
        onCancel={onCancel}
        sending={phase === 'sending'}
        error={error}
      />
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="kbf-move">
      <style>{moveStyles}</style>
      {children}
    </div>
  );
}

// Forge's 409s, read off the body our own route forwarded verbatim. Anything
// else — 403 (our credential), 422 (our payload) — has already collapsed into a
// generic 502 server-side and is none of the owner's business.
function blockFrom(status: number, body: any): MigrationBlock | null {
  if (status !== 409 || !isMigrationBlockCode(body?.error)) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    code: body.error,
    signInUrl: typeof body.signInUrl === 'string' ? body.signInUrl : null,
    cap: num(body.cap),
    used: num(body.used),
    requested: num(body.requested),
  };
}

function messageFor(status: number): string {
  if (status === 502) return 'SWU Forge did not accept the request. Nothing was sent — try again in a minute.';
  if (status === 403) return 'Only a team owner can move this team.';
  if (status === 404) return 'Moving teams to SWU Forge is not switched on yet.';
  return `Something went wrong (${status}).`;
}

// --- The preview form ---

function MoveForm({
  data,
  teamName,
  setTeamName,
  roles,
  setRoles,
  onConfirm,
  onCancel,
  sending,
  error,
}: {
  data: MigrationResponse;
  teamName: string;
  setTeamName: (v: string) => void;
  roles: Record<string, ForgeRole>;
  setRoles: (fn: (prev: Record<string, ForgeRole>) => Record<string, ForgeRole>) => void;
  onConfirm: () => void;
  onCancel: () => void;
  sending: boolean;
  error: string | null;
}) {
  const summary = useMemo(() => summarizePlan(data.plan), [data.plan]);

  // Forge keys its plan on the lowercased email; our roster keys on userId. The
  // email is the join, exactly as the contract says.
  const byEmail = useMemo(() => {
    const m = new Map<string, ForgeMigrationPlanMember>();
    for (const p of data.plan.members) m.set(p.email.toLowerCase(), p);
    return m;
  }, [data.plan]);

  // A second press only ever adds people. On a re-run, the rows Forge is still
  // willing to act on ARE the ones who are new since last time — so we can
  // highlight them without KaraBuddy tracking anything itself.
  const isRerun = data.plan.outcome !== 'created';
  const blocked = sending || (isRerun && summary.actionable === 0) || !teamName.trim();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label htmlFor="kbf-move-name" style={{ fontSize: 14, fontWeight: 600 }}>
          Team name on SWU Forge
        </label>
        <input
          id="kbf-move-name"
          className="kbf-move-name"
          data-testid="forge-team-name"
          value={teamName}
          onChange={(e) => setTeamName(e.target.value)}
          maxLength={FORGE_TEAM_NAME_MAX}
          style={{
            display: 'block',
            width: '100%',
            maxWidth: 480,
            marginTop: 8,
            background: f.bg,
            color: f.text,
            border: `1px solid ${f.border}`,
            borderRadius: f.radius,
            padding: '9px 12px',
            fontSize: 14,
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
        <p style={{ ...note, marginTop: 6, fontSize: 12.5 }}>
          SWU Forge allows {FORGE_TEAM_NAME_MAX} characters ({teamName.trim().length}/{FORGE_TEAM_NAME_MAX}).
          {isRerun &&
            (data.plan.teamName
              ? ` This team already exists on Forge as “${data.plan.teamName}”, so that name is left as it is.`
              : ' This team already exists on Forge, so the name there is left as it is.')}
        </p>
        {/* ⚠ `teamUrl` is NULL on the first preview — the Forge team does not
            exist yet, so it has no id and no URL, and Forge refuses to invent
            one. We say so rather than printing a link that 404s. */}
        <p data-testid="forge-team-url-note" style={{ ...note, marginTop: 4, fontSize: 12.5, overflowWrap: 'anywhere' }}>
          {data.plan.teamUrl ? (
            <>
              Already on SWU Forge:{' '}
              <a href={data.plan.teamUrl} target="_blank" rel="noopener noreferrer" data-testid="forge-existing-team-link" style={quietLink}>
                {data.plan.teamUrl}
              </a>
            </>
          ) : (
            'Nothing exists on SWU Forge yet — the team and its link are created when you confirm.'
          )}
        </p>
      </div>

      <MemberTable
        data={data}
        byEmail={byEmail}
        roles={roles}
        setRoles={setRoles}
        highlightActionable={isRerun}
      />

      <Totals summary={summary} isRerun={isRerun} />

      <ErrorNote style={{ fontSize: 13 }}>{error}</ErrorNote>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" onClick={onCancel} className="kbf-quiet" style={{ ...forgeButton, paddingLeft: 0 }}>
          Cancel
        </button>
        <button
          type="button"
          data-testid="forge-confirm"
          onClick={onConfirm}
          disabled={blocked}
          className="kbf-primary"
          style={{ ...forgeButton, opacity: blocked ? 0.5 : 1, cursor: blocked ? 'not-allowed' : 'pointer' }}
        >
          {confirmLabel(isRerun, sending, summary.actionable)}
        </button>
      </div>

      <p style={{ ...note, fontSize: 12.5, maxWidth: '72ch' }}>
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
  byEmail: Map<string, ForgeMigrationPlanMember>;
  roles: Record<string, ForgeRole>;
  setRoles: (fn: (prev: Record<string, ForgeRole>) => Record<string, ForgeRole>) => void;
  highlightActionable: boolean;
}) {
  return (
    <div style={{ border: `1px solid ${f.border}`, borderRadius: f.radius, overflow: 'hidden', background: f.surface }}>
      <div
        className="kbf-move-row kbf-move-head"
        style={{
          paddingTop: 8,
          paddingBottom: 8,
          background: f.headerBg,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: f.textMuted,
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
        tag={<Tag label="you" fg={f.softText} bg={f.softBg} title="You create and own the Forge team." />}
        roleCell={<LockedRole role="OWNER" title="A team needs an owner, and an invitation can't own anything." />}
      />

      {data.roster.map((m) => {
        const planned = byEmail.get(m.email);
        const action = planned?.action;
        const tagInfo = action ? ACTION_TAG[action] : null;
        const shown = rosterRole(planned, roles[m.userId] ?? m.defaultRole);
        const editable = shown.editable;
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
                <span style={{ fontSize: 12, color: f.textMuted }}>—</span>
              )
            }
            roleCell={
              shown.editable ? (
                <Select<ForgeRole>
                  value={shown.role}
                  onChange={(v) => setRoles((prev) => ({ ...prev, [m.userId]: v }))}
                  options={ROLE_OPTIONS}
                  ariaLabel={`Role for ${m.name || m.email}`}
                  testId={`forge-role-${m.userId}`}
                  size="md"
                  style={{ width: '100%', maxWidth: '100%', background: f.bg, color: f.text, border: `1px solid ${f.border}`, padding: '7px 10px', fontSize: 13 }}
                />
              ) : (
                <LockedRole
                  role={shown.role}
                  title="Forge already has a decision for this person — the migration never overwrites one."
                />
              )
            }
          />
        );
      })}

      {/* Forge identifies people by lowercased email and nothing else, so a
          member without one can't be matched or invited — and two KaraBuddy
          accounts that lowercase to the same address are ONE person over there.
          Both are named here rather than silently dropped. */}
      {data.excluded.map((m) => (
        <Row
          key={m.userId}
          name={m.name}
          email={m.email ?? 'no email on file'}
          dim
          tag={
            m.reason === 'duplicate_email' && m.email === data.initiator.email ? (
              <Tag
                label="duplicate of you"
                fg={tokens.color.warn}
                bg="rgba(224, 198, 74, 0.12)"
                title="This account has the same email address as yours. SWU Forge would see one person — you, as the team’s owner — so it doesn’t move separately."
              />
            ) : m.reason === 'duplicate_email' ? (
              <Tag
                label="duplicate"
                fg={tokens.color.warn}
                bg="rgba(224, 198, 74, 0.12)"
                title="Another account on this team has the same email address. SWU Forge would see one person, so only the longest-standing one moves."
              />
            ) : (
              <Tag
                label="can't move"
                fg={tokens.color.dangerSoft}
                bg="rgba(255, 122, 122, 0.1)"
                title="SWU Forge identifies people by email address."
              />
            )
          }
          roleCell={<span style={{ fontSize: 12, color: f.textMuted }}>—</span>}
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
  tag: ReactNode;
  roleCell: ReactNode;
  background?: string;
  dim?: boolean;
}) {
  return (
    <div className="kbf-move-row" style={{ borderTop: `1px solid ${f.border}`, background, opacity: dim ? 0.62 : 1 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: f.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name || email}
        </div>
        <div
          style={{
            fontSize: 12,
            color: f.textMuted,
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
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        padding: '3px 7px',
        borderRadius: 4,
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
    <span title={title} style={{ fontSize: 12, color: f.textMuted, fontFamily: tokens.led.mono }}>
      {role} 🔒
    </span>
  );
}

function Totals({ summary, isRerun }: { summary: ReturnType<typeof summarizePlan>; isRerun: boolean }) {
  if (summary.total === 0 && !isRerun) {
    return <p style={{ ...note, fontSize: 13.5 }}>Just you for now. SWU Forge creates the team with you as its owner.</p>;
  }
  const parts: { n: number; label: string }[] = [];
  if (summary.total) parts.push({ n: summary.total, label: summary.total === 1 ? 'member' : 'members' });
  if (summary.joined) {
    parts.push({
      n: summary.joined,
      label: 'will be added straight away',
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
        gap: '6px 18px',
        fontSize: 13.5,
        color: f.textMuted,
      }}
    >
      {parts.map((p) => (
        <span key={p.label}>
          <strong style={{ color: f.text, fontVariantNumeric: 'tabular-nums' }}>{p.n}</strong> {p.label}
        </span>
      ))}
    </div>
  );
}

// --- The terminal states ---

// One screen per refusal. ⛔ NOT a shared "couldn't move the team" message:
// each of these names a different thing the owner has to go and do, and the
// whole reason Forge answers them on a dry run is so a human reads them here,
// with nothing written and the roster still in front of them.
function MoveBlocked({ block, onRecheck }: { block: MigrationBlock; onRecheck: () => void }) {
  const copy = describeBlock(block);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 680 }}>
      <Notice testId={`forge-blocked-${block.code}`} icon={copy.icon} tone="danger" title={copy.title}>
        {copy.body}
      </Notice>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {/* 🔒 Forge's own sign-in URL, returned in the 409 body. Absent = no
            button, because the alternative is a link we invented. */}
        {block.code === 'initiator_has_no_forge_account' && block.signInUrl && (
          <a
            href={block.signInUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="forge-signup"
            className="kbf-primary"
            style={forgeButton}
          >
            Create your Forge account →
          </a>
        )}
        <button type="button" onClick={onRecheck} className="kbf-soft" style={forgeButton} data-testid="forge-recheck">
          {copy.recheck}
        </button>
      </div>
    </div>
  );
}

const NOTICE_TONE = {
  danger: { bg: 'rgba(255, 122, 122, 0.08)', border: 'rgba(255, 122, 122, 0.3)', title: '#ffd0d0' },
  success: { bg: 'rgba(107, 217, 104, 0.09)', border: 'rgba(107, 217, 104, 0.35)', title: f.text },
};

function Notice({
  icon,
  tone,
  title,
  titleTestId,
  testId,
  children,
}: {
  icon: string;
  tone: keyof typeof NOTICE_TONE;
  title: ReactNode;
  titleTestId?: string;
  testId?: string;
  children: ReactNode;
}) {
  const t = NOTICE_TONE[tone];
  return (
    <div
      data-testid={testId}
      style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '14px 16px', borderRadius: f.radius, background: t.bg, border: `1px solid ${t.border}` }}
    >
      <span style={{ fontSize: 17, lineHeight: 1.3 }} aria-hidden>
        {icon}
      </span>
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: t.title }} data-testid={titleTestId}>
          {title}
        </div>
        <p style={{ margin: '4px 0 0', fontSize: 13.5, color: f.text, opacity: 0.86, lineHeight: 1.55 }}>{children}</p>
      </div>
    </div>
  );
}

// The numbers in these sentences are FORGE'S, carried through from its body —
// a cap hardcoded here would be wrong the day Forge changed it, and silently.
function describeBlock(block: MigrationBlock): { icon: string; title: string; body: string; recheck: string } {
  const cap = block.cap;
  switch (block.code) {
    case 'initiator_has_no_forge_account':
      return {
        icon: '✋',
        title: 'You need a SWU Forge account first',
        body:
          'A team needs an owner, and an invitation can’t own anything — so we check before offering the move ' +
          'rather than creating a half-owned team. Sign in to SWU Forge once with the same email or Discord ' +
          'account, then come back.',
        recheck: 'I’ve done that — check again',
      };
    case 'initiator_has_no_profile':
      return {
        icon: '⚠️',
        title: 'Your SWU Forge account has no profile',
        body:
          'Forge gives every account a profile the moment it’s created, so this one is broken rather than new — ' +
          'and a profile is what actually holds a team membership there. Open SWU Forge once and check your ' +
          'profile; if it’s still missing, that one is for Forge support.',
        recheck: 'Check again',
      };
    case 'initiator_not_team_admin':
      return {
        icon: '🔒',
        title: 'This team has already moved, and you’re not an admin of it on SWU Forge',
        body:
          'Pressing again writes into the team that already exists over there, so it needs the same permission ' +
          'any other change to that team needs. Ask one of its Forge owners or admins to make you an admin — or ' +
          'to press this themselves. Nothing here was changed.',
        recheck: 'Check again',
      };
    case 'seats_full':
      return {
        icon: '🪑',
        title: cap === null ? 'That team is full on SWU Forge' : `SWU Forge teams hold ${cap} people`,
        body:
          (block.used !== null && block.requested !== null
            ? `The Forge team already accounts for ${block.used} (members plus invitations still outstanding), and ` +
              `this move would add ${block.requested} more. `
            : 'This roster needs more seats than the Forge team has left. ') +
          'Nobody was moved. Remove people from the KaraBuddy team — or free seats on Forge — and come back; ' +
          'anyone already offered a place stays offered, so a later press only picks up who is left.',
        recheck: 'Check again',
      };
    case 'initiator_has_no_email':
      return {
        icon: '✉️',
        title: 'Your KaraBuddy account has no email address',
        body:
          'SWU Forge knows people by email and nothing else, so it can’t tell who is moving the team — and whoever ' +
          'moves it becomes its owner there. KaraBuddy keeps the email your Discord or Google account gave it the ' +
          'first time you signed in; yours didn’t give one, and signing in again won’t add it. Another owner of ' +
          'this team can move it instead, or ask us on the KaraBuddy Discord to add your email. Nothing was sent.',
        recheck: 'Check again',
      };
    case 'roster_too_large':
      return {
        icon: '📋',
        title:
          cap === null
            ? 'This team is too big to move in one go'
            : `SWU Forge takes up to ${cap} people in one move`,
        body:
          (block.requested !== null ? `This team has ${block.requested}. ` : '') +
          'Nothing was sent. This is a limit on the move, not on SWU Forge teams — tell us if you have hit it, ' +
          'because we would rather fix the move than ask you to split the team.',
        recheck: 'Check again',
      };
    case 'team_cap_reached':
      return {
        icon: '🪐',
        title:
          cap === null
            ? 'You’re in the maximum number of teams on SWU Forge'
            : `You’re already in ${cap} teams on SWU Forge`,
        body:
          'The new team needs a seat for you too — you own it — and your Forge profile has none left. Leave a ' +
          'team on SWU Forge, or switch to a profile with room, then check again.',
        recheck: 'Check again',
      };
  }
}

function MoveResult({ data }: { data: MigrationResponse }) {
  const summary = summarizePlan(data.plan);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 720 }}>
      <Notice icon="✓" tone="success" titleTestId="forge-result-heading" title={`${forgeTeamName(data.plan, data.teamName)} is on SWU Forge`}>
        {summary.total === 0 ? (
          'You’re its only member for now.'
        ) : (
          <>
            <strong style={{ color: f.text }}>{summary.invited}</strong> invited by email — each joins when they accept
            {summary.joined > 0 && <> · {summary.joined} added straight away</>}
            {summary.alreadyOffered > 0 && <> · {summary.alreadyOffered} already offered, not asked again</>}
            {summary.declined > 0 && <> · {summary.declined} declined, not asked again</>}
            {summary.existingMember > 0 && <> · {summary.existingMember} already on the team</>}.
          </>
        )}
      </Notice>

      {/* A commit always comes back with the team's id, so this is the normal
          shape. Still guarded: the link is Forge's to give, and we render no
          link at all rather than assembling one out of an origin and a guess. */}
      {data.plan.teamUrl ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            background: f.bg,
            border: `1px solid ${f.border}`,
            borderRadius: f.radius,
            padding: '8px 8px 8px 12px',
            fontFamily: tokens.led.mono,
            fontSize: 12.5,
            color: f.textMuted,
            overflowWrap: 'anywhere',
          }}
        >
          <span>{data.plan.teamUrl}</span>
          <a
            href={data.plan.teamUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="forge-team-link"
            className="kbf-soft"
            style={{ ...forgeButton, marginLeft: 'auto', padding: '6px 12px', fontSize: 13 }}
          >
            Open on SWU Forge →
          </a>
        </div>
      ) : (
        <p style={note}>
          SWU Forge didn’t return a link for the team. Everything above was still carried out — open SWU Forge
          and it will be in your teams list.
        </p>
      )}

      <p style={note}>
        Your KaraBuddy team is unchanged — not archived, not locked, not deleted. Move it again from here later to
        invite anyone who joins after today; nobody is ever asked twice.
      </p>
    </div>
  );
}

function confirmLabel(isRerun: boolean, sending: boolean, actionable: number): string {
  if (sending) return isRerun ? 'Sending…' : 'Creating…';
  if (actionable === 0) return isRerun ? 'Nothing new to send' : 'Create team on SWU Forge';
  const invitations = `${actionable} invitation${actionable === 1 ? '' : 's'}`;
  return isRerun ? `Send ${invitations}` : `Create team and send ${invitations}`;
}
