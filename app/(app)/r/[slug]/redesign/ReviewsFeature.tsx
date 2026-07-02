'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'next/navigation';
import { tokens } from '@/app/_theme/karabuddyTokens';
import type { ViewerTag } from './TagsFeature';
import { useCreateTag } from './tagCompose';

// B216 redesign — the Reviews view: a FIRST-CLASS home for the (B149/ADR 0009)
// review flow, distinct from the Tags feed (which is all comments). Tags are the
// firehose; Reviews are people-scoped: who was asked, who's reviewed, and — for a
// reviewer — a summary of THEIR team-scoped comments with a single Submit that
// marks the review done + DMs the requester. Owner requests a review from Share.
// (Room to grow here: request a follow-up, filter the feed to one reviewer, etc.)

interface TeamStatus {
  teamSlug: string;
  teamName: string;
  requestedAt: string | null;
  reviewers: { userId: string; name: string | null; reviewedAt: string }[];
  reviewerCount: number;
  viewerReviewed: boolean;
  viewerCommented: boolean;
}

// Compact relative time ("3d ago"), falling back to an absolute date past a week.
// title carries the exact timestamp.
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const s = Math.max(0, (Date.now() - then) / 1000);
  if (s < 60) return 'just now';
  const m = s / 60; if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60; if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24; if (d < 7) return `${Math.floor(d)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function fullTime(iso: string): string { const t = new Date(iso); return Number.isNaN(t.getTime()) ? '' : t.toLocaleString(); }

export function ReviewsFeature({ replaySlug, tags, onJump, toOriginalFrame, updateTag, removeTag, isOwner }: {
  replaySlug: string;
  tags: ViewerTag[];
  onJump: (frame: number) => void;
  toOriginalFrame: (i: number) => number;
  updateTag: (id: string, patch: Partial<ViewerTag>) => void;
  removeTag: (id: string) => void;
  isOwner: boolean;
}) {
  const { isMine, edit, remove } = useCreateTag(replaySlug, toOriginalFrame, () => {}, updateTag, removeTag);
  const [rows, setRows] = useState<TeamStatus[] | null>(null);
  const [finishing, setFinishing] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // B194 deep-link (team Reviews tab → "Finish review →"): ?finishReview=<team>
  // auto-expands that team's summary once its status loads (only if the viewer can
  // actually finish), then strips the param so a manual close sticks. Captured
  // once — Strict Mode re-runs would otherwise see the stripped URL.
  // useSearchParams (not window.location): correct during client-side navs.
  const searchParams = useSearchParams();
  const [finishTarget] = useState<string | null>(() => searchParams.get('finishReview'));
  const autoOpenedRef = useRef(false);
  // Owner-only: their teams + which this replay is shared with / can be shared to,
  // so requesting a review lives HERE (not off in the Share view). Review is a
  // subset of shares, so requesting a not-yet-shared team shares it first.
  const [ownerTeams, setOwnerTeams] = useState<{ slug: string; name: string; shared: boolean; shareable: boolean }[]>([]);
  const [reqPending, setReqPending] = useState<Set<string>>(new Set());

  // Refetch on mount + whenever the viewer's own comment set changes, so the
  // "can finish" gate flips as soon as they leave a comment.
  const myCount = useMemo(() => tags.filter((t) => !t.parentTagId && isMine(t)).length, [tags]); // eslint-disable-line react-hooks/exhaustive-deps
  const load = useCallback(async () => {
    try { const res = await fetch(`/api/replays/${replaySlug}/review-status`); const b = await res.json(); if (b.ok) setRows(b.data || []); } catch { /* stays hidden */ }
  }, [replaySlug]);
  const loadOwnerTeams = useCallback(async () => {
    if (!isOwner) return;
    try {
      const res = await fetch(`/api/replays/${replaySlug}/team-shares`); const b = await res.json();
      if (!b.ok) return;
      const sharedSlugs = new Set((b.shares || []).map((s: { teamSlug: string }) => s.teamSlug));
      setOwnerTeams((b.ownerTeams || []).map((t: { slug: string; name: string; shareable: boolean }) => ({ slug: t.slug, name: t.name, shared: sharedSlugs.has(t.slug), shareable: t.shareable })));
    } catch { /* leave request UI hidden */ }
  }, [replaySlug, isOwner]);
  useEffect(() => { load(); }, [load, myCount]);
  useEffect(() => { loadOwnerTeams(); }, [loadOwnerTeams]);
  useEffect(() => {
    if (autoOpenedRef.current || !finishTarget || rows == null) return;
    const row = rows.find((t) => t.teamSlug === finishTarget);
    if (row && (row.viewerCommented || row.viewerReviewed)) {
      autoOpenedRef.current = true;
      setFinishing(row.teamSlug);
      try { const u = new URL(window.location.href); u.searchParams.delete('finishReview'); window.history.replaceState(null, '', u.toString()); } catch { /* param stays; harmless */ }
    }
  }, [rows, finishTarget]);

  // Owner: request a review from a team (sharing it first if needed — you can't
  // review what you can't see), or cancel an open request.
  const setRequest = async (team: { slug: string; shared: boolean }, requested: boolean) => {
    if (reqPending.has(team.slug)) return;
    setReqPending((p) => new Set(p).add(team.slug));
    try {
      if (requested && !team.shared) {
        const sr = await fetch(`/api/replays/${replaySlug}/team-shares`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ teamSlug: team.slug }) });
        const sb = await sr.json();
        if (!sb.ok) { alert(`Could not share with team: ${sb.error || 'unknown'}`); return; }
      }
      const rr = await fetch(`/api/replays/${replaySlug}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ teamSlug: team.slug, requested }) });
      const rb = await rr.json();
      if (!rb.ok) { alert(`Could not ${requested ? 'request' : 'cancel'} review: ${rb.error || 'unknown'}`); return; }
      await Promise.all([load(), loadOwnerTeams()]);
    } catch { alert('Network error updating the review request.'); }
    finally { setReqPending((p) => { const n = new Set(p); n.delete(team.slug); return n; }); }
  };

  const commentsFor = (teamSlug: string) =>
    tags.filter((t) => !t.parentTagId && isMine(t) && (t.scope ?? []).includes(teamSlug)).sort((a, b) => a.frameIndex - b.frameIndex);

  const submit = async (teamSlug: string) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/replays/${replaySlug}/reviewed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ teamSlug, reviewed: true }) });
      const b = await res.json();
      if (!b.ok) { alert(`Could not submit: ${b.error || 'unknown'}`); return; }
      setFinishing(null); load();
    } catch { alert('Network error submitting review.'); }
    finally { setSubmitting(false); }
  };

  if (rows == null) return <div style={{ padding: '24px 16px', textAlign: 'center', color: tokens.color.textMuted, fontSize: 13 }}>Loading…</div>;

  const requestedSlugs = new Set(rows.map((r) => r.teamSlug));
  const candidates = ownerTeams.filter((t) => !requestedSlugs.has(t.slug));
  if (rows.length === 0 && candidates.length === 0) return (
    <div style={{ padding: '24px 16px', textAlign: 'center', color: tokens.color.textMuted, fontSize: 13, lineHeight: 1.5 }}>
      {isOwner ? 'No reviews yet — share this replay with a team to request one.' : 'No reviews requested on this replay.'}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 14px 28px' }}>
      {rows.map((t) => {
        const canFinish = t.viewerReviewed || t.viewerCommented;
        const open = finishing === t.teamSlug;
        const mine = commentsFor(t.teamSlug);
        return (
          <div key={t.teamSlug} style={{ border: `1px solid ${tokens.color.border}`, borderRadius: 12, background: 'rgba(255,255,255,0.03)', padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: tokens.color.textSecondary }}>{t.teamName}</span>
              <span style={{ fontSize: 11, color: t.reviewerCount > 0 ? '#7fd97f' : tokens.color.textMuted }}>{t.reviewerCount > 0 ? `reviewed by ${t.reviewerCount}` : 'no reviews yet'}</span>
            </div>
            {t.requestedAt && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: tokens.color.textFaint }} title={fullTime(t.requestedAt)}>Requested {timeAgo(t.requestedAt)}</span>
                {isOwner && <button type="button" disabled={reqPending.has(t.teamSlug)} onClick={() => setRequest({ slug: t.teamSlug, shared: true }, false)} style={{ ...linkBtn, color: '#ff8a7a', opacity: reqPending.has(t.teamSlug) ? 0.5 : 1 }}>Cancel request</button>}
              </div>
            )}
            {t.reviewerCount > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {t.reviewers.map((r) => (
                  <div key={r.userId} style={{ fontSize: 11.5, color: tokens.color.textMuted }} title={fullTime(r.reviewedAt)}>
                    <span aria-hidden style={{ color: '#7fd97f' }}>✓</span> {r.name || 'someone'} · reviewed {timeAgo(r.reviewedAt)}
                  </div>
                ))}
              </div>
            )}

            {!open ? (
              <button type="button" disabled={!canFinish} onClick={() => canFinish && setFinishing(t.teamSlug)} title={canFinish ? undefined : 'Leave a comment scoped to this team first'}
                data-testid={`viewer-finish-review-${t.teamSlug}`}
                style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 12px', borderRadius: 8, cursor: canFinish ? 'pointer' : 'not-allowed', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700,
                  background: !canFinish ? 'transparent' : 'rgba(107,217,104,0.12)', border: `1px solid ${!canFinish ? 'rgba(160,168,184,0.22)' : 'rgba(107,217,104,0.5)'}`, color: !canFinish ? tokens.color.textMuted : '#8fe08a' }}>
                {t.viewerReviewed ? 'Update review →' : canFinish ? 'Finish review →' : 'Comment to review'}
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 2 }}>
                <div style={{ fontSize: 11.5, color: tokens.color.textMuted }}>{mine.length} comment{mine.length === 1 ? '' : 's'} for {t.teamName} — edit or remove, then submit.</div>
                {mine.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: tokens.color.textFaint, fontStyle: 'italic' }}>No comments scoped to {t.teamName} yet.</div>
                ) : mine.map((c) => (
                  <div key={c.id} style={{ border: `1px solid ${tokens.color.border}`, borderRadius: 8, padding: '8px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                      <button type="button" onClick={() => onJump(c.frameIndex)} style={{ background: 'transparent', border: 0, color: tokens.color.accent, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>Frame {c.frameIndex + 1} ↗</button>
                      <div style={{ display: 'flex', gap: 10 }}>
                        {editingId !== c.id && <button type="button" onClick={() => { setEditingId(c.id); setDraft(c.comment); }} style={linkBtn}>Edit</button>}
                        <button type="button" onClick={() => remove(c.id)} style={{ ...linkBtn, color: '#ff8a7a' }}>Delete</button>
                      </div>
                    </div>
                    {editingId === c.id ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <textarea value={draft} autoFocus rows={2} onChange={(e) => setDraft(e.target.value)}
                          style={{ width: '100%', boxSizing: 'border-box', background: tokens.color.bg, color: tokens.color.text, border: `1px solid ${tokens.color.border}`, borderRadius: 6, padding: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          <button type="button" onClick={() => setEditingId(null)} style={linkBtn}>Cancel</button>
                          <button type="button" disabled={!draft.trim()} onClick={async () => { await edit(c.id, draft.trim()); setEditingId(null); }} style={{ ...primaryBtn, opacity: draft.trim() ? 1 : 0.5 }}>Save</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 13, color: tokens.color.text, lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.comment || '(empty)'}</div>
                    )}
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 2 }}>
                  <button type="button" onClick={() => setFinishing(null)} style={linkBtn}>Cancel</button>
                  <button type="button" disabled={submitting || mine.length === 0} onClick={() => submit(t.teamSlug)} style={{ ...primaryBtn, padding: '7px 16px', opacity: submitting || mine.length === 0 ? 0.5 : 1 }}>{submitting ? 'Submitting…' : t.viewerReviewed ? 'Update review' : 'Submit review'}</button>
                </div>
                <span style={{ fontSize: 11, color: tokens.color.textMuted, textAlign: 'center' }}>{t.viewerReviewed ? 'Notifies the requester you updated your review.' : 'Marks the review done and notifies the requester.'}</span>
              </div>
            )}
          </div>
        );
      })}

      {isOwner && candidates.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: rows.length > 0 ? 6 : 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: tokens.color.textMuted }}>Request a review</span>
          {candidates.map((tm) => {
            const busy = reqPending.has(tm.slug);
            return (
              <div key={tm.slug} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, border: `1px solid ${tokens.color.border}`, borderRadius: 10, padding: '9px 12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: tokens.color.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tm.name}</span>
                  <span style={{ fontSize: 10.5, color: tokens.color.textFaint }}>{tm.shareable ? (tm.shared ? 'shared with this team' : 'will share this replay') : 'private team — can’t share this replay'}</span>
                </div>
                <button type="button" disabled={busy || !tm.shareable} onClick={() => setRequest(tm, true)}
                  title={tm.shareable ? undefined : 'A private team can only review replays uploaded with its key'}
                  style={{ flex: '0 0 auto', padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                    cursor: busy || !tm.shareable ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
                    background: tm.shareable ? 'rgba(77,210,255,0.14)' : 'transparent',
                    border: `1px solid ${tm.shareable ? tokens.led.on : 'rgba(160,168,184,0.22)'}`,
                    color: tm.shareable ? '#eaf9ff' : tokens.color.textMuted }}>
                  {busy ? 'Requesting…' : 'Request review'}
                </button>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

const linkBtn: CSSProperties = { background: 'transparent', border: 0, color: '#a0a8b8', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0 };
const primaryBtn: CSSProperties = { background: 'rgba(107,217,104,0.16)', color: '#8fe08a', border: '1px solid rgba(107,217,104,0.5)', borderRadius: 8, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', padding: '5px 12px' };
