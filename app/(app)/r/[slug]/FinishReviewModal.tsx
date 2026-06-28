'use client';

import { useEffect, useState } from 'react';
import { tokens } from '@/app/_theme/karabuddyTokens';

// B194: the "Finish review" summary. A teammate who was asked to review a replay
// reviews it by leaving frame-anchored comments; this collects THEIR team-scoped
// comments into one view to edit/delete/jump before a single Submit that marks the
// review done (and DMs the requester, server-side). Edit/delete reuse the parent's
// tag handlers (so the live tag list stays in sync); jump closes + seeks the board.
export interface ReviewComment { id: string; frameIndex: number; comment: string }

export function FinishReviewModal({
  teamName, comments, alreadyReviewed = false, onEdit, onDelete, onJump, onSubmit, onClose,
}: {
  teamName: string;
  comments: ReviewComment[];
  // B195: re-opened on an already-finished review (add to / edit, then re-notify).
  // No "undo" — a sent review can't be unsent.
  alreadyReviewed?: boolean;
  onEdit: (id: string, text: string) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
  onJump: (frameIndex: number) => void;
  onSubmit: () => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const beginEdit = (c: ReviewComment) => { setEditingId(c.id); setDraft(c.comment); };
  const saveEdit = async (id: string) => { await onEdit(id, draft.trim()); setEditingId(null); };

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true); setError(null);
    const res = await onSubmit();
    if (!res.ok) { setError(res.error || 'Could not submit'); setSubmitting(false); return; }
    onClose();
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label={`${alreadyReviewed ? 'Update' : 'Finish'} review for ${teamName}`} onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(560px, 96vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', background: '#0f1318', border: `1px solid ${tokens.surface.panelBorder}`, borderRadius: tokens.radius.lg, color: '#e6e6e6', fontFamily: 'var(--font-barlow), sans-serif', boxShadow: '0 16px 50px rgba(0,0,0,0.6)' }}>
        {/* Header */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '14px 16px', borderBottom: '1px solid #1c2128' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{alreadyReviewed ? 'Update' : 'Finish'} review · {teamName}</span>
            <span style={{ fontSize: 12, color: '#8a93a6' }}>
              {comments.length} comment{comments.length === 1 ? '' : 's'}
              {alreadyReviewed ? ' — edit or add notes, then re-notify the requester.' : ' — edit or remove, then submit.'}
            </span>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 0, color: '#4dd2ff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Close</button>
        </div>

        {/* Comment list */}
        <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {comments.length === 0 ? (
            <div style={{ color: '#6c7588', fontStyle: 'italic', padding: '24px 0', textAlign: 'center' }}>No comments for {teamName} yet — leave one on a frame first.</div>
          ) : comments.map((c) => (
            <div key={c.id} style={{ border: '1px solid #1c2128', borderRadius: 8, padding: '8px 10px', background: 'rgba(255,255,255,0.015)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                <button type="button" onClick={() => onJump(c.frameIndex)} title="Jump to this frame"
                  style={{ background: 'transparent', border: 0, color: '#a7d2ff', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                  Frame {c.frameIndex + 1} ↗
                </button>
                <div style={{ display: 'flex', gap: 10 }}>
                  {editingId !== c.id && <button type="button" onClick={() => beginEdit(c)} style={linkBtn}>Edit</button>}
                  <button type="button" onClick={() => onDelete(c.id)} style={{ ...linkBtn, color: '#ff8a7a' }}>Delete</button>
                </div>
              </div>
              {editingId === c.id ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus rows={2}
                    style={{ width: '100%', boxSizing: 'border-box', background: '#11141a', color: '#e6e6e6', border: '1px solid #2e333c', borderRadius: 6, padding: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" onClick={() => setEditingId(null)} style={linkBtn}>Cancel</button>
                    <button type="button" onClick={() => saveEdit(c.id)} disabled={!draft.trim()} style={{ ...primaryBtn, opacity: draft.trim() ? 1 : 0.5, padding: '4px 12px' }}>Save</button>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: '#d6d6d6', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{c.comment || <em style={{ color: '#6c7588' }}>(empty)</em>}</div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ flexShrink: 0, padding: '12px 16px', borderTop: '1px solid #1c2128', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {error && <span style={{ fontSize: 12, color: '#ff6b6b' }}>{error}</span>}
          <button type="button" onClick={submit} disabled={submitting || comments.length === 0}
            style={{ ...primaryBtn, width: '100%', padding: '10px', opacity: submitting || comments.length === 0 ? 0.5 : 1 }}>
            {submitting ? 'Submitting…' : alreadyReviewed ? 'Update review' : 'Submit review'}
          </button>
          <span style={{ fontSize: 11, color: '#6c7588', textAlign: 'center' }}>
            {alreadyReviewed ? 'Notifies the requester that you updated your review.' : 'Marks the review done and notifies the requester.'}
          </span>
        </div>
      </div>
    </div>
  );
}

const linkBtn: React.CSSProperties = { background: 'transparent', border: 0, color: '#a0a8b8', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0 };
const primaryBtn: React.CSSProperties = { background: 'rgba(107,217,104,0.16)', color: '#7fd97f', border: '1px solid rgba(107,217,104,0.5)', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center' };
