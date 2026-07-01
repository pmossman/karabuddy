'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
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
  reviewers: { userId: string; name: string | null; reviewedAt: string }[];
  reviewerCount: number;
  viewerReviewed: boolean;
  viewerCommented: boolean;
}

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

  // Refetch on mount + whenever the viewer's own comment set changes, so the
  // "can finish" gate flips as soon as they leave a comment.
  const myCount = useMemo(() => tags.filter((t) => !t.parentTagId && isMine(t)).length, [tags]); // eslint-disable-line react-hooks/exhaustive-deps
  const load = useCallback(async () => {
    try { const res = await fetch(`/api/replays/${replaySlug}/review-status`); const b = await res.json(); if (b.ok) setRows(b.data || []); } catch { /* stays hidden */ }
  }, [replaySlug]);
  useEffect(() => { load(); }, [load, myCount]);

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
  if (rows.length === 0) return (
    <div style={{ padding: '24px 16px', textAlign: 'center', color: tokens.color.textMuted, fontSize: 13, lineHeight: 1.5 }}>
      No reviews requested on this replay.{isOwner ? ' Request one from a team in the Share view.' : ''}
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
            {t.reviewerCount > 0 && <div style={{ fontSize: 11.5, color: tokens.color.textMuted }}>{t.reviewers.map((r) => r.name || 'someone').join(', ')}</div>}

            {!open ? (
              <button type="button" disabled={!canFinish} onClick={() => canFinish && setFinishing(t.teamSlug)} title={canFinish ? undefined : 'Leave a comment scoped to this team first'}
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
    </div>
  );
}

const linkBtn: CSSProperties = { background: 'transparent', border: 0, color: '#a0a8b8', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0 };
const primaryBtn: CSSProperties = { background: 'rgba(107,217,104,0.16)', color: '#8fe08a', border: '1px solid rgba(107,217,104,0.5)', borderRadius: 8, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', padding: '5px 12px' };
