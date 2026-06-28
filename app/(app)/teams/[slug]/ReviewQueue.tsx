'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ReplayCard } from '@/app/(app)/replays/ReplayCard';
import { tokens } from '@/app/_theme/karabuddyTokens';

// B149 / ADR 0009: the team's Reviews tab. Requests are durable — a replay never
// leaves after one review. Each member leaves their OWN "✓ I reviewed" mark;
// marks accumulate ("reviewed by N") so the whole team can pile eyes on a replay
// and browse each other's reviews. Filter: Awaiting your review / Reviewed / All.
type Reviewer = { userId: string; name: string | null; reviewedAt: string };
type Row = {
  slug: string;
  reviewRequestedAt: string | null;
  reviewers: Reviewer[];
  reviewerCount: number;
  viewerReviewed: boolean;
  viewerCommented: boolean;
  commenters: string[];
  commentCount: number;
  [k: string]: unknown;
};
type Filter = 'awaiting' | 'reviewed' | 'all';

export function ReviewQueue({ teamSlug }: { teamSlug: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('awaiting');
  const [marking, setMarking] = useState<Set<string>>(new Set());
  const router = useRouter();

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

  // Per-user mark — the card STAYS; it just flips your status + the count.
  const toggleReviewed = async (slug: string, current: boolean) => {
    if (marking.has(slug)) return;
    setMarking((p) => new Set(p).add(slug));
    try {
      const res = await fetch(`/api/replays/${slug}/reviewed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamSlug, reviewed: !current }),
      });
      const body = await res.json();
      if (body.ok) await load(); // refresh marks (names/count) from the server
    } catch {
      /* leave it; the user can retry */
    } finally {
      setMarking((p) => { const n = new Set(p); n.delete(slug); return n; });
    }
  };

  const counts = useMemo(() => ({
    awaiting: rows.filter((r) => !r.viewerReviewed).length,
    reviewed: rows.filter((r) => r.reviewerCount > 0).length,
    all: rows.length,
  }), [rows]);

  const visible = useMemo(() => rows.filter((r) =>
    filter === 'awaiting' ? !r.viewerReviewed : filter === 'reviewed' ? r.reviewerCount > 0 : true,
  ), [rows, filter]);

  if (state === 'loading') return <div style={{ fontSize: 12, color: '#6c7588' }}>Loading reviews…</div>;
  if (state === 'error') return <div style={{ fontSize: 12, color: '#ff7a7a' }}>{error}</div>;
  if (rows.length === 0) {
    return (
      <div style={{ fontSize: 13, color: '#6c7588', padding: '24px 0', lineHeight: 1.5 }}>
        No replays up for review. An uploader requests one from its{' '}
        <strong style={{ color: '#a0a8b8' }}>Share</strong>{' '}menu — &ldquo;Request team review&rdquo; on a team they&apos;ve shared it with.
      </div>
    );
  }

  const chip = (key: Filter, label: string, n: number) => (
    <button
      type="button"
      onClick={() => setFilter(key)}
      data-testid={`review-filter-${key}`}
      style={{
        background: filter === key ? 'rgba(86, 199, 255, 0.16)' : 'transparent',
        border: `1px solid ${filter === key ? 'rgba(86, 199, 255, 0.5)' : 'rgba(160,168,184,0.22)'}`,
        color: filter === key ? '#8fd6ff' : '#a0a8b8',
        borderRadius: tokens.radius.md, padding: '5px 11px', fontSize: 12.5,
        fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
      }}
    >
      {label} <span style={{ opacity: 0.7 }}>{n}</span>
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {chip('awaiting', 'Awaiting your review', counts.awaiting)}
        {chip('reviewed', 'Reviewed', counts.reviewed)}
        {chip('all', 'All', counts.all)}
      </div>

      {visible.length === 0 ? (
        <div style={{ fontSize: 13, color: '#6c7588', padding: '12px 0' }}>
          {filter === 'awaiting' ? 'You’ve reviewed everything here. Nice.' : 'Nothing here yet.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
          {visible.map((r) => (
            <div key={r.slug} data-testid="review-queue-item" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <ReplayCard replay={r as any} canManage={false} />

              {/* reviewers + commenters summary */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11.5, color: '#8a93a6' }}>
                <span>
                  {r.reviewerCount === 0
                    ? 'No reviews yet'
                    : `Reviewed by ${r.reviewers.map((x) => x.name || 'someone').join(', ')}`}
                </span>
                {r.commentCount > 0 && (
                  <span style={{ color: '#6c7588' }}>
                    💬 {r.commentCount} {r.commentCount === 1 ? 'note' : 'notes'}
                    {r.commenters.length ? ` · ${r.commenters.join(', ')}` : ''}
                  </span>
                )}
              </div>

              {(() => {
                // A review means you left feedback — the mark is gated on a
                // team-scoped comment (you can always undo your own mark).
                const canMark = r.viewerReviewed || r.viewerCommented;
                const busy = marking.has(r.slug);
                // B194: completing a review always goes through the viewer's
                // summary modal, so "Finish review →" deep-links into the replay
                // (where your comments live) and auto-opens it. Undo stays a
                // direct one-click toggle; the un-commented gate is unchanged.
                const onClick = () => {
                  if (busy || !canMark) return;
                  if (r.viewerReviewed) { toggleReviewed(r.slug, true); return; }
                  router.push(`/r/${r.slug}?finishReview=${teamSlug}`);
                };
                return (
                  <button
                    type="button"
                    onClick={onClick}
                    disabled={busy || !canMark}
                    data-testid={`mark-reviewed-${r.slug}`}
                    title={canMark ? undefined : 'Leave a comment on the replay before reviewing it'}
                    style={{
                      alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 7,
                      background: !canMark ? 'transparent' : r.viewerReviewed ? 'rgba(107, 217, 104, 0.18)' : 'rgba(107, 217, 104, 0.08)',
                      border: `1px solid ${!canMark ? 'rgba(160,168,184,0.22)' : `rgba(107, 217, 104, ${r.viewerReviewed ? 0.55 : 0.32})`}`,
                      color: !canMark ? '#6c7588' : '#7fd97f', borderRadius: tokens.radius.md, padding: '6px 12px',
                      fontSize: 12.5, fontWeight: 700,
                      cursor: busy ? 'default' : canMark ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
                    }}
                  >
                    {busy ? '…' : (
                      <>
                        <span aria-hidden>{r.viewerReviewed ? '✓' : canMark ? '🔎' : '💬'}</span>
                        <span>{r.viewerReviewed ? 'You reviewed — undo' : canMark ? 'Finish review →' : 'Comment to review'}</span>
                      </>
                    )}
                  </button>
                );
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
