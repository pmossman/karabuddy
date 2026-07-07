'use client';

import { useCallback, useEffect, useState } from 'react';
import { ReplayFilters } from '@/app/(app)/replays/ReplayFilters';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { ErrorNote, Loading } from '@/app/_components/StatusUi';

// B55b: client-fetched team replays grid.
// B52-followup: now wrapped in ReplayFilters so the team page gets the
// same filter UI + URL persistence + view switcher as /replays. Surface
// rule (tag by team member OR explicit share) is still enforced server-side.
export function TeamReplays({ teamSlug }: { teamSlug: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  // B82: filter to teammate-vs-teammate ("internal") matches.
  const [internalOnly, setInternalOnly] = useState(false);

  // Extracted so a bulk op (e.g. unshare) can refetch the grid afterward.
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/teams/${teamSlug}/replays`);
      const body = await res.json();
      if (!body.ok) { setError(body.error || 'failed to load'); setState('error'); return; }
      setRows(body.data || []);
      setState('ready');
    } catch (err: any) {
      setError(err?.message || 'network error');
      setState('error');
    }
  }, [teamSlug]);

  useEffect(() => { void load(); }, [load]);

  if (state === 'loading') {
    return <Loading label="replays" />;
  }

  if (state === 'error') {
    return <ErrorNote>{error}</ErrorNote>;
  }

  // B116: rows arrive already serialized by lib/replayRow (shared with the
  // personal library) — no per-field remap needed here.
  const internalCount = rows.filter((r) => r.internal).length;
  const shown = internalOnly ? rows.filter((r) => r.internal) : rows;

  return (
    <>
      {internalCount > 0 && (
        <div style={{ display: 'inline-flex', gap: 4, marginBottom: 12, background: tokens.surface.panel, border: `1px solid ${tokens.surface.panelBorder}`, borderRadius: tokens.radius.md, padding: 3 }}>
          {([['All', false], [`Internal (${internalCount})`, true]] as const).map(([label, val]) => (
            <button
              key={label}
              type="button"
              onClick={() => setInternalOnly(val)}
              title={val ? 'Matches played between teammates' : undefined}
              style={{
                background: internalOnly === val ? '#4d9dff' : 'transparent',
                color: internalOnly === val ? '#fff' : '#a0a8b8',
                border: 0, borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <ReplayFilters
        rows={shown}
        canManage={false}
        showUploaderFilter
        pageSize={60}
        teamSlug={teamSlug}
        cardFinder
        onMutated={load}
        emptyState={
          <div style={{ fontSize: 12, color: '#a0a8b8', lineHeight: 1.5 }}>
            {internalOnly
              ? 'No teammate-vs-teammate matches yet (both players must be team members with their karabast username set in Settings).'
              : 'No team replays yet. Replays surface here when a team member tags one, or when an owner explicitly shares a replay with the team from its viewer page.'}
          </div>
        }
      />
    </>
  );
}
