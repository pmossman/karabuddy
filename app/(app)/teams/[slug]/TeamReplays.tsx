'use client';

import { useCallback, useEffect, useState } from 'react';
import { ReplayFilters } from '@/app/(app)/replays/ReplayFilters';
import { CardSearch, type SelectedCard } from '@/app/_components/CardSearch';
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
  // B226: card finder — pick a card → narrow to replays where a teammate played
  // it, each deep-linking to the frame of the play. `frames` is slug → play
  // frame (null while loading a fresh card).
  const [card, setCard] = useState<SelectedCard | null>(null);
  const [frames, setFrames] = useState<Record<string, number> | null>(null);
  const [cardLoading, setCardLoading] = useState(false);

  useEffect(() => {
    if (!card) { setFrames(null); return; }
    let dead = false;
    setCardLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/teams/${teamSlug}/card-plays?cardId=${encodeURIComponent(card.cardId)}`);
        const j = await res.json();
        if (!dead) setFrames(j.ok ? j.plays : {});
      } catch {
        if (!dead) setFrames({});
      } finally {
        if (!dead) setCardLoading(false);
      }
    })();
    return () => { dead = true; };
  }, [card, teamSlug]);

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
  let shown = internalOnly ? rows.filter((r) => r.internal) : rows;
  // B226: with a card selected, keep only replays a teammate played it in.
  if (card && frames) shown = shown.filter((r) => r.slug in frames);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        {internalCount > 0 && (
          <div style={{ display: 'inline-flex', gap: 4, background: tokens.surface.panel, border: `1px solid ${tokens.surface.panelBorder}`, borderRadius: tokens.radius.md, padding: 3 }}>
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
        {/* B226: card finder. Narrows to replays where a teammate played the
            card; each result jumps to the play. */}
        <CardSearch value={card} onChange={setCard} testId="card-search" />
        {card && (
          <span data-testid="card-play-count" style={{ fontSize: 12.5, color: '#8a93a3' }}>
            {cardLoading ? 'searching…' : `${shown.length} ${shown.length === 1 ? 'replay' : 'replays'} · jump to the play`}
          </span>
        )}
      </div>
      <ReplayFilters
        rows={shown}
        canManage={false}
        showUploaderFilter
        pageSize={60}
        teamSlug={teamSlug}
        cardPlayFrames={frames ?? undefined}
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
