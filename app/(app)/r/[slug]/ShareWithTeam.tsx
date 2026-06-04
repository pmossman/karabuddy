'use client';

import { useEffect, useState } from 'react';
import { LedToggle } from '@/app/_components/LedToggle';

// B55b: replay-owner UI for sharing a replay explicitly with one or more
// of their teams. Lives inside the existing Share popover in TagSidebar.
// Renders nothing if the owner has zero teams (no-op state) — the user
// can join/create teams from /teams.
//
// Server-side rules enforced by /api/replays/[slug]/team-shares:
//   - GET returns existing shares + the owner's teams (so we can show
//     each team as a checkbox, ticked iff shared)
//   - POST adds a share row; owner-only AND caller must be a member of
//     the team being shared with
//   - DELETE removes a share row; owner-only
export function ShareWithTeam({
  replaySlug,
  installToken,
  onArmedTeamsChange,
}: {
  replaySlug: string;
  installToken: string;
  // Reports the LIVE shared subset (teams this replay is shared with, of the
  // owner's teams) so the comment scope chip tracks in-session share changes
  // instead of the page-load snapshot. Called on load + after every toggle.
  onArmedTeamsChange?: (teams: { slug: string; name: string }[]) => void;
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error' | 'unauth'>('loading');
  const [shares, setShares] = useState<Set<string>>(new Set());
  const [teams, setTeams] = useState<{ slug: string; name: string }[]>([]);
  const [pending, setPending] = useState<Set<string>>(new Set());
  // B100: tags on this replay scoped to each team — drives the "un-sharing
  // also removes N comments" confirmation.
  const [scopedCounts, setScopedCounts] = useState<Record<string, number>>({});
  // Pending un-share awaiting confirmation (only set when it would untag
  // comments from the team).
  const [confirm, setConfirm] = useState<{ slug: string; name: string; count: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/replays/${replaySlug}/team-shares`, {
          headers: { 'X-Install-Token': installToken },
        });
        const body = await res.json();
        if (cancelled) return;
        if (res.status === 403) {
          // Non-owner — don't render anything. Should not happen because
          // the parent already gated on isOwner, but defense in depth.
          setState('unauth');
          return;
        }
        if (!body.ok) {
          setState('error');
          return;
        }
        setShares(new Set((body.shares || []).map((s: any) => s.teamSlug)));
        setTeams(body.ownerTeams || []);
        setScopedCounts(body.scopedTagCounts || {});
        setState(body.ownerTeams && body.ownerTeams.length > 0 ? 'ready' : 'empty');
      } catch {
        if (cancelled) return;
        setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [replaySlug, installToken]);

  // Keep the parent's `armedTeams` in sync with the live shared set — on the
  // initial load and after each optimistic toggle (incl. a failed-toggle
  // revert, which mutates `shares`). Only fires once data has loaded so we
  // don't clobber the parent's GET /tags snapshot with an empty set mid-fetch.
  // `onArmedTeamsChange` is the parent's stable setState, so [shares, teams,
  // state] are the only triggers — no render loop.
  useEffect(() => {
    if (state !== 'ready' && state !== 'empty') return;
    onArmedTeamsChange?.(teams.filter((t) => shares.has(t.slug)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shares, teams, state]);

  // Toggle entry point: turning a team OFF that has comments scoped to it
  // first asks for confirmation (the un-share strips those comments from the
  // team). Everything else applies immediately.
  const requestToggle = (teamSlug: string) => {
    if (pending.has(teamSlug)) return;
    const wasShared = shares.has(teamSlug);
    const affected = scopedCounts[teamSlug] ?? 0;
    if (wasShared && affected > 0) {
      const t = teams.find((x) => x.slug === teamSlug);
      setConfirm({ slug: teamSlug, name: t?.name ?? teamSlug, count: affected });
      return;
    }
    applyToggle(teamSlug);
  };

  const applyToggle = async (teamSlug: string) => {
    if (pending.has(teamSlug)) return;
    const wasShared = shares.has(teamSlug);
    // Optimistic update — revert on failure.
    setShares((prev) => {
      const next = new Set(prev);
      if (wasShared) next.delete(teamSlug);
      else next.add(teamSlug);
      return next;
    });
    setPending((prev) => new Set(prev).add(teamSlug));
    try {
      const res = await fetch(`/api/replays/${replaySlug}/team-shares`, {
        method: wasShared ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Install-Token': installToken },
        body: JSON.stringify({ teamSlug }),
      });
      const body = await res.json();
      if (!body.ok) {
        // Revert.
        setShares((prev) => {
          const next = new Set(prev);
          if (wasShared) next.add(teamSlug);
          else next.delete(teamSlug);
          return next;
        });
      } else if (wasShared) {
        // Un-share succeeded: the server stripped this team from the replay's
        // tag scopes, so nothing more is scoped to it.
        setScopedCounts((prev) => ({ ...prev, [teamSlug]: 0 }));
      }
    } catch {
      setShares((prev) => {
        const next = new Set(prev);
        if (wasShared) next.add(teamSlug);
        else next.delete(teamSlug);
        return next;
      });
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(teamSlug);
        return next;
      });
    }
  };

  if (state === 'loading' || state === 'unauth') return null;
  if (state === 'error') {
    return <div style={{ fontSize: 11, color: '#ff7a7a', fontStyle: 'italic' }}>Couldn&apos;t load team shares.</div>;
  }
  if (state === 'empty') {
    return (
      <div style={{ fontSize: 11, color: '#6c7588', fontStyle: 'italic' }}>
        You&apos;re not in any teams yet. Create or join one at{' '}
        <a href="/teams" style={{ color: '#5db4ff' }}>/teams</a>.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 11, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Share with team
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {teams.map((t) => {
          const isShared = shares.has(t.slug);
          const isPending = pending.has(t.slug);
          return (
            <LedToggle
              key={t.slug}
              checked={isShared}
              onChange={() => requestToggle(t.slug)}
              label={t.name}
              statusOn="Sharing"
              disabled={isPending}
            />
          );
        })}
      </div>
      {shares.size > 0 && (
        <div style={{ fontSize: 11, color: '#6c7588', fontStyle: 'italic' }}>
          Surfaces in the selected teams&apos; replay grid.
        </div>
      )}
      {confirm && (
        <UnshareConfirm
          teamName={confirm.name}
          count={confirm.count}
          onCancel={() => setConfirm(null)}
          onConfirm={() => { const slug = confirm.slug; setConfirm(null); applyToggle(slug); }}
        />
      )}
    </div>
  );
}

// B100: confirmation for an un-share that will also untag comments from the
// team. Explains the consequence in plain terms before it happens. Rendered
// inline (a child of the kebab menu, where ShareWithTeam lives on the team
// grid) so the menu's outside-click guard keeps it mounted while you read it
// — but it must reset `white-space` because the table's actions cell sets
// `nowrap`, which would otherwise inherit in and stop the copy wrapping.
function UnshareConfirm({
  teamName,
  count,
  onConfirm,
  onCancel,
}: {
  teamName: string;
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const noun = count === 1 ? 'comment is' : 'comments are';
  const message =
    `This removes the replay from ${teamName}'s browser. ${count} ${noun} scoped to ` +
    `${teamName} and will be untagged from the team — they stay on the replay but ` +
    `won't appear in ${teamName}'s discussion anymore.`;

  return (
    <div
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, whiteSpace: 'normal' }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={`Un-share from ${teamName}`}
        data-testid="unshare-confirm"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(440px, 92vw)', boxSizing: 'border-box', background: '#11141a', border: '1px solid #2e333c', borderRadius: 10, padding: 18, color: '#e6e6e6', fontFamily: 'var(--font-barlow), sans-serif', textAlign: 'left' }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Un-share from {teamName}?</div>
        <p style={{ fontSize: 13, color: '#c2c8d4', lineHeight: 1.5, margin: '0 0 16px', wordBreak: 'break-word' }}>
          {message}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{ background: 'transparent', border: '1px solid #2e333c', color: '#a0a8b8', padding: '6px 14px', borderRadius: 6, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="unshare-confirm-button"
            onClick={onConfirm}
            style={{ background: 'rgba(255,107,107,0.14)', border: '1px solid #5a2a2a', color: '#ff6b6b', padding: '6px 14px', borderRadius: 6, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Un-share
          </button>
        </div>
      </div>
    </div>
  );
}
