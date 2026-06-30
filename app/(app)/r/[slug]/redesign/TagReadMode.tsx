'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { tokens } from '@/app/_theme/karabuddyTokens';
import type { ViewerTag } from './TagsFeature';
import { useCreateTag, SignInToTagCta } from './tagCompose';

// B216 redesign — "Tag Mode": the expanded form of the Tags rail icon. The icon
// is always present (minimal: a current-frame tag count); tapping it expands THIS
// floating window over the board (board stays interactive). Everything tag lives
// here: read the current frame's tag(s), jump to prev/next tagged frames (with a
// PREVIEW so you recognise them), and compose. Closing collapses back to the icon.

const truncate = (s: string, n = 22) => { const t = (s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

export function TagReadMode({ tags, currentIndex, onJump, onClose, onOpenList, replaySlug, toOriginalFrame, appendTag }: {
  tags: ViewerTag[];
  currentIndex: number;
  onJump: (frame: number) => void;
  onClose: () => void;
  onOpenList: () => void;
  replaySlug: string;
  toOriginalFrame: (i: number) => number;
  appendTag: (t: ViewerTag) => void;
}) {
  const top = useMemo(() => tags.filter((t) => !t.parentTagId).sort((a, b) => a.frameIndex - b.frameIndex), [tags]);
  const here = useMemo(() => top.filter((t) => t.frameIndex === currentIndex), [top, currentIndex]);
  const prev = useMemo(() => [...top].reverse().find((t) => t.frameIndex < currentIndex) || null, [top, currentIndex]);
  const next = useMemo(() => top.find((t) => t.frameIndex > currentIndex) || null, [top, currentIndex]);
  const replies = useMemo(() => {
    const m = new Map<string, ViewerTag[]>();
    for (const t of tags) if (t.parentTagId) { const a = m.get(t.parentTagId) ?? []; a.push(t); m.set(t.parentTagId, a); }
    return m;
  }, [tags]);

  // Draggable bubble offset (window listeners + clamp so it can't leave the view).
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);
  const onDown = (e: React.PointerEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, ox = pos.x, oy = pos.y;
    const m = 8, keepBottom = 90;
    const move = (ev: PointerEvent) => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const dx = Math.min(Math.max(ev.clientX - sx, m - rect.left), (vw - m) - rect.right);
      const dy = Math.min(Math.max(ev.clientY - sy, m - rect.top), (vh - keepBottom) - rect.top);
      setPos({ x: ox + dx, y: oy + dy });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); cleanupRef.current = null; };
    cleanupRef.current = up;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div style={{ position: 'fixed', inset: 'var(--kb-header-h, 0px) 0 0 0', zIndex: 140, pointerEvents: 'none' }}>
      <div ref={wrapRef} style={{ position: 'absolute', top: 12 + pos.y, left: '50%', transform: `translateX(calc(-50% + ${pos.x}px))`, width: 'min(440px, 92vw)', pointerEvents: 'auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '64vh', background: tokens.color.surfaceSolid, border: `1px solid ${tokens.color.borderStrong}`, borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.55)', overflow: 'hidden' }}>
          {/* Header doubles as the drag handle. ✕ collapses back to the icon. */}
          <div data-testid="tag-bubble-drag" onPointerDown={onDown}
            style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', cursor: 'grab', borderBottom: `1px solid ${tokens.color.border}`, touchAction: 'none' }}>
            <span aria-hidden style={{ color: tokens.led.on, fontSize: 13 }}>🏷</span>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: tokens.color.textMuted }}>
              Frame {currentIndex + 1}{here.length > 0 ? ` · ${here.length} tag${here.length > 1 ? 's' : ''}` : ''}
            </span>
            <span aria-hidden style={{ marginLeft: 6, color: tokens.color.textFaint, fontSize: 12 }}>⠿</span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button type="button" onClick={onOpenList} title="All tags (list)" aria-label="All tags" style={iconBtn}>≡</button>
              <button type="button" onClick={onClose} title="Minimise to the tag icon" aria-label="Minimise" style={iconBtn}>✕</button>
            </span>
          </div>

          {/* Prev/next tagged-frame nav — lives INSIDE the panel, with previews. */}
          {(prev || next) && (
            <div style={{ flex: '0 0 auto', display: 'flex', gap: 6, padding: '7px 8px', borderBottom: `1px solid ${tokens.color.border}` }}>
              <NavBtn dir="prev" tag={prev} onClick={() => prev && onJump(prev.frameIndex)} />
              <NavBtn dir="next" tag={next} onClick={() => next && onJump(next.frameIndex)} />
            </div>
          )}

          <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
            {here.length === 0 ? (
              <div style={{ padding: '16px', textAlign: 'center', color: tokens.color.textMuted, fontSize: 12.5 }}>No tag on this frame — jump to one above, or add one below.</div>
            ) : here.map((t) => (
              <div key={t.id} style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '10px 12px', borderTop: `1px solid ${tokens.color.border}` }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#e8ecf3' }}>{t.authorName || 'Anonymous'}</div>
                <div style={{ fontSize: 14, lineHeight: 1.45, color: tokens.color.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{t.comment}</div>
                {(replies.get(t.id) ?? []).map((r) => (
                  <div key={r.id} style={{ marginLeft: 8, paddingLeft: 8, borderLeft: `1px solid ${tokens.color.border}` }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#cdd4df' }}>{r.authorName || 'Anonymous'}: </span>
                    <span style={{ fontSize: 12.5, color: tokens.color.textSecondary }}>{r.comment}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <ComposeFooter replaySlug={replaySlug} currentIndex={currentIndex} toOriginalFrame={toOriginalFrame} appendTag={appendTag} />
        </div>
      </div>
    </div>
  );
}

function NavBtn({ dir, tag, onClick }: { dir: 'prev' | 'next'; tag: ViewerTag | null; onClick: () => void }) {
  const arrow = dir === 'prev' ? '‹' : '›';
  const disabled = !tag;
  const label = tag ? truncate(tag.comment, 18) : (dir === 'prev' ? 'No earlier tag' : 'No later tag');
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={tag ? `Frame ${tag.frameIndex + 1}: ${tag.comment}` : undefined}
      style={{
        flex: 1, minWidth: 0, display: 'inline-flex', alignItems: 'center', justifyContent: dir === 'prev' ? 'flex-start' : 'flex-end', gap: 5,
        background: disabled ? 'transparent' : tokens.color.surface, border: `1px solid ${tokens.color.border}`, color: disabled ? tokens.color.textFaint : tokens.color.accent,
        borderRadius: 8, padding: '6px 10px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: disabled ? 'default' : 'pointer',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
      {dir === 'prev' ? `${arrow} ${label}` : `${label} ${arrow}`}
    </button>
  );
}

function ComposeFooter({ replaySlug, currentIndex, toOriginalFrame, appendTag }: {
  replaySlug: string; currentIndex: number; toOriginalFrame: (i: number) => number; appendTag: (t: ViewerTag) => void;
}) {
  const { signedIn, authorName, create } = useCreateTag(replaySlug, toOriginalFrame, appendTag);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => { if (busy || !draft.trim()) return; setBusy(true); const ok = await create(currentIndex, draft); setBusy(false); if (ok) { setDraft(''); setOpen(false); } };

  const border = `1px solid ${tokens.color.border}`;
  if (!signedIn) return <div style={{ flex: '0 0 auto', borderTop: border, padding: 10 }}><SignInToTagCta replaySlug={replaySlug} compact /></div>;
  if (!open) {
    return (
      <div style={{ flex: '0 0 auto', borderTop: border }}>
        <button type="button" onClick={() => setOpen(true)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: 0, color: tokens.color.primary, padding: '11px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          <span aria-hidden>✎</span> Tag this frame
        </button>
      </div>
    );
  }
  return (
    <div style={{ flex: '0 0 auto', borderTop: border, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, background: tokens.color.primarySoft }}>
      <div style={{ fontSize: 11, color: tokens.color.textSecondary }}>Tagging frame {currentIndex + 1} as {authorName}</div>
      <textarea value={draft} autoFocus rows={2} onChange={(e) => setDraft(e.target.value)} placeholder="Your note about this moment…"
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit(); }}
        style={{ width: '100%', boxSizing: 'border-box', background: tokens.color.bg, color: tokens.color.text, border: `1px solid ${tokens.color.border}`, borderRadius: 6, padding: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={() => { setOpen(false); setDraft(''); }} style={{ background: 'transparent', border: 0, color: tokens.color.textSecondary, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
        <button type="button" onClick={submit} disabled={busy || !draft.trim()} style={{ background: 'rgba(77,157,255,0.16)', color: tokens.color.primary, border: `1px solid ${tokens.color.primary}`, borderRadius: 6, padding: '5px 14px', fontSize: 12.5, fontWeight: 800, cursor: busy || !draft.trim() ? 'default' : 'pointer', opacity: busy || !draft.trim() ? 0.5 : 1, fontFamily: 'inherit' }}>{busy ? 'Saving…' : 'Save tag'}</button>
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = { background: 'transparent', border: 0, color: tokens.color.accent, cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, lineHeight: 1, padding: '2px 4px' };
