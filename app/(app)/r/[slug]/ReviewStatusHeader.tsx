'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { tokens } from '@/app/_theme/karabuddyTokens';

// B149 / ADR 0009: the review-status strip at the top of the viewer's Review
// panel. For each of the viewer's teams that has an OPEN review request on this
// replay, shows who's reviewed + an in-place "✓ Mark reviewed" toggle (gated on
// the viewer having commented, same rule as the team Reviews tab). Refetches
// when `refreshKey` changes (e.g. the viewer adds a comment → can now review).
interface TeamStatus {
  teamSlug: string;
  teamName: string;
  reviewers: { userId: string; name: string | null; reviewedAt: string }[];
  reviewerCount: number;
  viewerReviewed: boolean;
  viewerCommented: boolean;
}

export function ReviewStatusHeader({ replaySlug, refreshKey, onFinish }: { replaySlug: string; refreshKey: number; onFinish: (team: { teamSlug: string; teamName: string; alreadyReviewed: boolean }) => void }) {
  const [rows, setRows] = useState<TeamStatus[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/replays/${replaySlug}/review-status`);
      const body = await res.json();
      if (body.ok) setRows(body.data || []);
    } catch { /* ignore; the header just stays hidden */ }
  }, [replaySlug]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // B194: deep-link auto-open. The team Reviews tab routes "Finish review →" here
  // as /r/<slug>?finishReview=<teamSlug>; once the status loads, open the summary
  // modal for that team (only if you've commented but not yet reviewed it) and
  // strip the param so a refetch / closing the modal doesn't reopen it.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current || !rows) return;
    let target: string | null = null;
    try { target = new URLSearchParams(window.location.search).get('finishReview'); } catch {}
    if (!target) return;
    const row = rows.find((t) => t.teamSlug === target);
    if (row && (row.viewerCommented || row.viewerReviewed)) {
      autoOpenedRef.current = true;
      onFinish({ teamSlug: row.teamSlug, teamName: row.teamName, alreadyReviewed: row.viewerReviewed });
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('finishReview');
        window.history.replaceState(null, '', url.toString());
      } catch { /* param stays; harmless */ }
    }
  }, [rows, onFinish]);

  if (!rows || rows.length === 0) return null;

  return (
    <section data-testid="review-status-header" style={{ padding: '12px 16px', borderBottom: '1px solid #2e333c', flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {rows.map((t) => {
        const canMark = t.viewerReviewed || t.viewerCommented;
        return (
          <div key={t.teamSlug} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 10.5, color: '#8a93a6', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                🔍 {t.teamName} review
              </span>
              <span style={{ fontSize: 11, color: t.reviewerCount > 0 ? '#7fd97f' : '#6c7588' }}>
                {t.reviewerCount > 0 ? `reviewed by ${t.reviewerCount}` : 'no reviews yet'}
              </span>
            </div>
            {t.reviewerCount > 0 && (
              <div style={{ fontSize: 11, color: '#8a93a6' }}>{t.reviewers.map((r) => r.name || 'someone').join(', ')}</div>
            )}
            {/* Commented but not reviewed → "Finish review" opens the summary
                modal (Submit marks it done + notifies). Already reviewed →
                "Update review" reopens it to add/edit + re-notify (B195: no undo —
                a sent review can't be unsent). Haven't commented → disabled hint. */}
            <button
              type="button"
              onClick={() => { if (canMark) onFinish({ teamSlug: t.teamSlug, teamName: t.teamName, alreadyReviewed: t.viewerReviewed }); }}
              disabled={!canMark}
              data-testid={`viewer-finish-review-${t.teamSlug}`}
              title={canMark ? undefined : 'Leave a comment below before finishing your review'}
              style={{
                alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 7,
                background: !canMark ? 'transparent' : t.viewerReviewed ? 'rgba(107, 217, 104, 0.18)' : 'rgba(107, 217, 104, 0.08)',
                border: `1px solid ${!canMark ? 'rgba(160,168,184,0.22)' : `rgba(107, 217, 104, ${t.viewerReviewed ? 0.55 : 0.32})`}`,
                color: !canMark ? '#6c7588' : '#7fd97f', borderRadius: tokens.radius.md, padding: '5px 11px',
                fontSize: 12, fontWeight: 700, cursor: canMark ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
              }}
            >
              <span aria-hidden>{t.viewerReviewed ? '📝' : canMark ? '🔎' : '💬'}</span>
              <span>{t.viewerReviewed ? 'Update review →' : canMark ? 'Finish review →' : 'Comment to review'}</span>
            </button>
          </div>
        );
      })}
    </section>
  );
}
