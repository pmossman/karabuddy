'use client';

import { useCallback, useEffect, useState } from 'react';
import { ReplayCard } from '@/app/(app)/replays/ReplayCard';
import { tokens } from '@/app/_theme/karabuddyTokens';

// B135: the team's Review queue — replays the uploader flagged for review by
// this team. Any member can "Mark reviewed" to clear an item (collaborative).
type Row = { slug: string; reviewRequestedAt: string | null; [k: string]: unknown };

export function ReviewQueue({ teamSlug }: { teamSlug: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/teams/${teamSlug}/review-queue`);
      const body = await res.json();
      if (!body.ok) { setError(body.error || 'failed to load'); setState('error'); return; }
      setRows(body.data || []);
      setState('ready');
    } catch (err: any) {
      setError(err?.message || 'network error');
      setState('error');
    }
  }, [teamSlug]);

  useEffect(() => { load(); }, [load]);

  const markReviewed = async (slug: string) => {
    if (clearing.has(slug)) return;
    setClearing((p) => new Set(p).add(slug));
    try {
      const res = await fetch(`/api/replays/${slug}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamSlug, requested: false }),
      });
      const body = await res.json();
      if (body.ok) setRows((prev) => prev.filter((r) => r.slug !== slug));
    } catch {
      /* leave it; the user can retry */
    } finally {
      setClearing((p) => { const n = new Set(p); n.delete(slug); return n; });
    }
  };

  if (state === 'loading') return <div style={{ fontSize: 12, color: '#6c7588' }}>Loading review queue…</div>;
  if (state === 'error') return <div style={{ fontSize: 12, color: '#ff7a7a' }}>{error}</div>;
  if (rows.length === 0) {
    return (
      <div style={{ fontSize: 13, color: '#6c7588', padding: '24px 0', lineHeight: 1.5 }}>
        Nothing queued for review. An uploader adds a replay here from its{' '}
        <strong style={{ color: '#a0a8b8' }}>Share</strong> menu — &ldquo;Request team review&rdquo; on a team they&apos;ve shared it with.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ margin: 0, fontSize: 13, color: '#a0a8b8' }}>
        {rows.length} {rows.length === 1 ? 'replay' : 'replays'} waiting for the team&apos;s eyes. Mark one reviewed when you&apos;ve left your notes.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
        {rows.map((r) => (
          <div key={r.slug} data-testid="review-queue-item" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <ReplayCard replay={r as any} canManage={false} />
            <button
              type="button"
              onClick={() => markReviewed(r.slug)}
              disabled={clearing.has(r.slug)}
              data-testid={`mark-reviewed-${r.slug}`}
              style={{
                alignSelf: 'flex-start',
                background: 'rgba(107, 217, 104, 0.12)', border: '1px solid rgba(107, 217, 104, 0.4)',
                color: '#7fd97f', borderRadius: tokens.radius.md, padding: '6px 12px',
                fontSize: 12.5, fontWeight: 700, cursor: clearing.has(r.slug) ? 'default' : 'pointer', fontFamily: 'inherit',
              }}
            >
              {clearing.has(r.slug) ? 'Clearing…' : '✓ Mark reviewed'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
