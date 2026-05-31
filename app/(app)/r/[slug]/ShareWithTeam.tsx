'use client';

import { useEffect, useState } from 'react';

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

  const toggle = async (teamSlug: string) => {
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
        <a href="/teams" style={{ color: '#5da9ff' }}>/teams</a>.
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
            <label
              key={t.slug}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: isPending ? 'wait' : 'pointer',
                opacity: isPending ? 0.6 : 1,
                fontSize: 12,
                color: '#d6d6d6',
              }}
            >
              <input
                type="checkbox"
                checked={isShared}
                onChange={() => toggle(t.slug)}
                disabled={isPending}
                style={{ accentColor: '#4a7cff' }}
              />
              <span>{t.name}</span>
            </label>
          );
        })}
      </div>
      {shares.size > 0 && (
        <div style={{ fontSize: 11, color: '#6c7588', fontStyle: 'italic' }}>
          Surfaces in the selected teams&apos; replay grid.
        </div>
      )}
    </div>
  );
}
