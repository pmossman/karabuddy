'use client';

import { useEffect, useState } from 'react';
import { ReplayFilters } from '@/app/(app)/replays/ReplayFilters';

// B55b: client-fetched team replays grid.
// B52-followup: now wrapped in ReplayFilters so the team page gets the
// same filter UI + URL persistence + view switcher as /replays. Surface
// rule (tag by team member OR explicit share) is still enforced server-side.
export function TeamReplays({ teamSlug }: { teamSlug: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/teams/${teamSlug}/replays`);
        const body = await res.json();
        if (cancelled) return;
        if (!body.ok) {
          setError(body.error || 'failed to load');
          setState('error');
          return;
        }
        setRows(body.data || []);
        setState('ready');
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message || 'network error');
        setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [teamSlug]);

  if (state === 'loading') {
    return (
      <div style={{ fontSize: 12, color: '#6c7588' }}>Loading replays…</div>
    );
  }

  if (state === 'error') {
    return (
      <div style={{ fontSize: 12, color: '#ff7a7a' }}>{error}</div>
    );
  }

  const normalized = rows.map((r) => ({
    slug: r.slug,
    gameId: r.gameId,
    userId: r.userId,
    players: r.players,
    durationMs: r.durationMs,
    actionCount: r.actionCount,
    visibility: r.visibility,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date(r.createdAt).toISOString(),
    match: r.match ?? null,
    displayName: r.displayName ?? null,
    labels: r.labels ?? null,
    ownerName: r.ownerName ?? null,
    winners: r.winners ?? null,
    ownerPlayerId: r.ownerPlayerId ?? null,
  }));

  return (
    <ReplayFilters
      rows={normalized}
      canManage={false}
      emptyState={
        <div style={{ fontSize: 12, color: '#a0a8b8', lineHeight: 1.5 }}>
          No team replays yet. Replays surface here when a team member tags one,
          or when an owner explicitly shares a replay with the team from its
          viewer page.
        </div>
      }
    />
  );
}
