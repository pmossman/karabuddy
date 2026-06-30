'use client';

import { useMemo, useRef, useState } from 'react';
import { tokens } from '@/app/_theme/karabuddyTokens';
import type { ViewerTag } from './TagsFeature';
import { useCreateTag, SignInToTagCta } from './tagCompose';

// B216 redesign — "Tag Mode": a board-VISIBLE reading experience for mobile.
// Full-screen is great for scanning, but reading-while-watching needs the board
// and the tag at once. So: a draggable floating bubble shows the current frame's
// tag(s); compose lives INSIDE that same bubble (it's the tag-centric surface);
// prev/next chips PREVIEW the neighbouring tags ("‹ Here I'd resource…") and jump
// the board to them. The board stays interactive (container pointer-events:none;
// only the chrome captures input).

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

  // Draggable bubble offset (pointer-based; works for touch + mouse).
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const onDown = (e: React.PointerEvent) => { drag.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y }; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); };
  const onMove = (e: React.PointerEvent) => { if (drag.current) setPos({ x: drag.current.ox + (e.clientX - drag.current.sx), y: drag.current.oy + (e.clientY - drag.current.sy) }); };
  const onUp = () => { drag.current = null; };

  return (
    <div style={{ position: 'fixed', inset: 'var(--kb-header-h, 0px) 0 0 0', zIndex: 140, pointerEvents: 'none' }}>
      {/* Floating, draggable tag bubble (top) — reading + composing both live here. */}
      <div style={{ position: 'absolute', top: 12 + pos.y, left: '50%', transform: `translateX(calc(-50% + ${pos.x}px))`, width: 'min(440px, 92vw)', pointerEvents: 'auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '62vh', background: tokens.color.surfaceSolid, border: `1px solid ${tokens.color.borderStrong}`, borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.55)', overflow: 'hidden' }}>
          <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
            style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', cursor: 'grab', borderBottom: `1px solid ${tokens.color.border}`, touchAction: 'none' }}>
            <span aria-hidden style={{ color: tokens.led.on, fontSize: 13 }}>🏷</span>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: tokens.color.textMuted }}>
              Frame {currentIndex + 1}{here.length > 1 ? ` · ${here.length} tags` : ''}
            </span>
            <span aria-hidden style={{ marginLeft: 6, color: tokens.color.textFaint, fontSize: 12 }}>⠿</span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button type="button" onClick={onOpenList} title="All tags (list)" aria-label="All tags" style={iconBtn}>≡</button>
              <button type="button" onClick={onClose} title="Exit tag mode" aria-label="Exit tag mode" style={iconBtn}>✕</button>
            </span>
          </div>
          <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
            {here.length === 0 ? (
              <div style={{ padding: '16px', textAlign: 'center', color: tokens.color.textMuted, fontSize: 12.5 }}>No tag on this frame — use ‹ › below to jump to one, or add one.</div>
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
          {/* Compose lives in the bubble — it's the tag-centric surface. */}
          <ComposeFooter replaySlug={replaySlug} currentIndex={currentIndex} toOriginalFrame={toOriginalFrame} appendTag={appendTag} />
        </div>
      </div>

      {/* Prev/Next tag chips WITH preview text (bottom-centre, clear of corners). */}
      <div style={{ position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 8, maxWidth: '96vw', pointerEvents: 'auto' }}>
        <NavChip dir="prev" tag={prev} onClick={() => prev && onJump(prev.frameIndex)} />
        <NavChip dir="next" tag={next} onClick={() => next && onJump(next.frameIndex)} />
      </div>
    </div>
  );
}

function NavChip({ dir, tag, onClick }: { dir: 'prev' | 'next'; tag: ViewerTag | null; onClick: () => void }) {
  const arrow = dir === 'prev' ? '‹' : '›';
  const base: React.CSSProperties = { maxWidth: '44vw', display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(17,20,26,0.92)', border: `1px solid ${tokens.color.borderStrong}`, borderRadius: 999, padding: '8px 13px', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', boxShadow: '0 2px 8px rgba(0,0,0,0.4)' };
  if (!tag) return <span style={{ ...base, color: tokens.color.textFaint, opacity: 0.6 }}>{dir === 'prev' ? `${arrow} no earlier tag` : `no later tag ${arrow}`}</span>;
  const preview = `${arrow === '‹' ? arrow + ' ' : ''}${truncate(tag.comment)}${arrow === '›' ? ' ' + arrow : ''}`;
  return <button type="button" onClick={onClick} title={`Frame ${tag.frameIndex + 1}: ${tag.comment}`} style={{ ...base, color: tokens.color.accent, cursor: 'pointer' }}>{preview}</button>;
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
