'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { tokens } from '@/app/_theme/karabuddyTokens';
import type { ViewerTag } from './TagsFeature';
import { useCreateTag, SignInToTagCta } from './tagCompose';

// B216 redesign — the Tag HUD: a glassy, iOS-style bubble floating over the board
// showing the CURRENT frame's tag(s). Draggable (clamped on-screen). When a frame
// has multiple comments (same or different authors), a tab strip pages between
// them. Minimal controls: add, reply, EDIT (own comments), prev/next-tag nav with
// a shortened preview. The full feed lives in the sidebar / a full-page takeover.

const truncate = (s: string, n = 22) => { const t = (s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const COLORS = ['#4dd2ff', '#6bd968', '#e0c64a', '#ff8a7a', '#c08bff', '#5db4ff', '#ff9f4d'];
function authorColor(name: string): string { let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0; return COLORS[Math.abs(h) % COLORS.length]; }

const GLASS: React.CSSProperties = {
  background: 'rgba(16, 20, 28, 0.55)',
  backdropFilter: 'blur(20px) saturate(1.4)',
  WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
  border: '1px solid rgba(255,255,255,0.14)',
  boxShadow: '0 12px 44px rgba(0,0,0,0.5)',
};

type Editor = null | { kind: 'add' } | { kind: 'reply'; id: string } | { kind: 'edit'; id: string };

export function TagHud({ tags, currentIndex, onJump, replaySlug, toOriginalFrame, appendTag, updateTag, canTag, sidebarW = 0 }: {
  tags: ViewerTag[];
  currentIndex: number;
  onJump: (frame: number) => void;
  replaySlug: string;
  toOriginalFrame: (i: number) => number;
  appendTag: (t: ViewerTag) => void;
  updateTag: (id: string, patch: Partial<ViewerTag>) => void;
  canTag: boolean;
  sidebarW?: number;
}) {
  const { signedIn, authorName, isMine, create, edit } = useCreateTag(replaySlug, toOriginalFrame, appendTag, updateTag);

  const top = useMemo(() => tags.filter((t) => !t.parentTagId).sort((a, b) => a.frameIndex - b.frameIndex), [tags]);
  const here = useMemo(() => top.filter((t) => t.frameIndex === currentIndex), [top, currentIndex]);
  const prev = useMemo(() => [...top].reverse().find((t) => t.frameIndex < currentIndex) || null, [top, currentIndex]);
  const next = useMemo(() => top.find((t) => t.frameIndex > currentIndex) || null, [top, currentIndex]);
  const replies = useMemo(() => {
    const m = new Map<string, ViewerTag[]>();
    for (const t of tags) if (t.parentTagId) { const a = m.get(t.parentTagId) ?? []; a.push(t); m.set(t.parentTagId, a); }
    return m;
  }, [tags]);

  const [tab, setTab] = useState(0);
  const [editor, setEditor] = useState<Editor>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  // Minimized → collapse to a slim pill (get it out of the way of the board).
  // Sticky across frames so you can scrub with it tucked.
  const [minimized, setMinimized] = useState(false);
  // New frame → reset to the first comment + close any editor.
  useEffect(() => { setTab(0); setEditor(null); }, [currentIndex]);
  const activeIdx = Math.min(tab, Math.max(0, here.length - 1));
  const active = here[activeIdx] || null;

  // Draggable (from anywhere on the panel chrome) + resizable. Window listeners so
  // the pointer can leave the panel; clamp so it can't be flung off-screen.
  const wrapRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState<{ w: number | null; h: number | null }>({ w: null, h: null });
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);
  const recenter = () => { setPos({ x: 0, y: 0 }); setSize({ w: null, h: null }); };

  // Navigating to a new tag GROWS the panel to fit it if the content would
  // otherwise be clipped/scroll; a smaller tag leaves the size untouched. Grow
  // downward (keep the top edge fixed via the centre-anchor offset).
  useEffect(() => {
    if (minimized) return;
    const body = bodyRef.current, bubble = bubbleRef.current;
    if (!body || !bubble) return;
    const overflow = body.scrollHeight - body.clientHeight;
    if (overflow <= 4) return; // fits (or smaller) → no resize
    const cur = bubble.getBoundingClientRect().height;
    const newH = Math.min(window.innerHeight * 0.82, cur + overflow);
    if (newH > cur + 1) {
      const delta = newH - cur;
      setSize((s) => ({ w: s.w, h: newH }));
      setPos((p) => ({ x: p.x, y: p.y + delta / 2 }));
    }
  }, [active?.id, currentIndex, minimized]);

  const onDown = (e: React.PointerEvent) => {
    // Drag from anywhere EXCEPT interactive bits and the scrollable body (marked
    // data-no-drag) — so controls, the textarea, and reading/scrolling all work.
    if ((e.target as HTMLElement).closest('button, a, textarea, input, select, [data-no-drag]')) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, ox = pos.x, oy = pos.y, m = 8, keepBottom = 90;
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

  // Resize from the bottom-right grip. The panel is centre-anchored, so to keep the
  // top-left corner put while the grip follows the pointer we shift the centre by
  // half the size delta.
  const onResizeDown = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const rect = bubbleRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX, sy = e.clientY, ow = rect.width, oh = rect.height, opx = pos.x, opy = pos.y;
    const move = (ev: PointerEvent) => {
      const maxW = Math.min(620, window.innerWidth * 0.94);
      const maxH = window.innerHeight * 0.82;
      // Floor keeps the control bar on one row (capped so it never exceeds the viewport).
      const minW = Math.min(332, window.innerWidth * 0.92);
      const nw = Math.min(maxW, Math.max(minW, ow + (ev.clientX - sx)));
      const nh = Math.min(maxH, Math.max(150, oh + (ev.clientY - sy)));
      setSize({ w: nw, h: nh });
      setPos({ x: opx + (nw - ow) / 2, y: opy + (nh - oh) / 2 });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); cleanupRef.current = null; };
    cleanupRef.current = up;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const openEditor = (e: Editor, initial = '') => { setEditor(e); setDraft(initial); };
  const submit = async () => {
    if (busy || !draft.trim() || !editor) return;
    setBusy(true);
    const ok = editor.kind === 'edit' ? await edit(editor.id, draft)
      : editor.kind === 'reply' ? await create(currentIndex, draft, editor.id)
      : await create(currentIndex, draft);
    setBusy(false);
    if (ok) { setDraft(''); setEditor(null); }
  };

  return (
    <div ref={wrapRef} style={{ position: 'fixed', top: '50%', left: '50%', transform: `translate(calc(-50% - ${sidebarW / 2}px + ${pos.x}px), calc(-50% + ${pos.y}px))`, zIndex: 130, width: size.w != null ? size.w : 'min(420px, 90vw)', pointerEvents: 'none' }}>
      {minimized ? (
        <MiniRow onDown={onDown} active={active} currentIndex={currentIndex} prev={prev} next={next} onJump={onJump} onExpand={() => setMinimized(false)} />
      ) : (
      <div ref={bubbleRef} onPointerDown={onDown} style={{ ...GLASS, borderRadius: 20, position: 'relative', pointerEvents: 'auto', display: 'flex', flexDirection: 'column', height: size.h != null ? size.h : undefined, maxHeight: size.h != null ? undefined : '56vh', overflow: 'hidden', color: '#eef2f8', fontFamily: 'var(--font-barlow), sans-serif', cursor: 'grab' }}>
        {/* Drag handle (the whole panel chrome drags; this bar is the obvious grip). */}
        <div data-testid="taghud-drag" style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', touchAction: 'none', borderBottom: here.length > 1 ? 'none' : '1px solid rgba(255,255,255,0.1)' }}>
          <span aria-hidden style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>⠿</span>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.6)' }}>
            Frame {currentIndex + 1}{here.length > 0 ? ` · ${here.length} tag${here.length > 1 ? 's' : ''}` : ''}
          </span>
          <button type="button" onClick={recenter} title="Re-center & reset size" aria-label="Re-center"
            style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', background: 'transparent', border: 0, color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontFamily: 'inherit', padding: '0 4px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
              <circle cx="12" cy="12" r="3.2" /><line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" /><line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" />
            </svg>
          </button>
          <button type="button" onClick={() => setMinimized(true)} title="Minimize" aria-label="Minimize"
            style={{ background: 'transparent', border: 0, color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 20, fontWeight: 700, lineHeight: 1, padding: '0 4px' }}>−</button>
        </div>

        {/* Tabs when the frame has multiple comments. */}
        {here.length > 1 && (
          <div style={{ flex: '0 0 auto', display: 'flex', gap: 6, padding: '0 10px 8px', overflowX: 'auto', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
            {here.map((t, i) => {
              const on = i === activeIdx;
              return (
                <button key={t.id} type="button" onClick={() => { setTab(i); setEditor(null); }} title={t.authorName || 'Anonymous'}
                  style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 5, background: on ? 'rgba(255,255,255,0.16)' : 'transparent', border: `1px solid ${on ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.12)'}`, color: on ? '#fff' : 'rgba(255,255,255,0.7)', borderRadius: 999, padding: '4px 9px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: authorColor(t.authorName || 'anon') }} />
                  {truncate(t.authorName || 'Anon', 10)}
                </button>
              );
            })}
          </div>
        )}

        {/* Body — the active comment (+ replies), or the inline editor, or empty.
            data-no-drag so scrolling/selecting here doesn't move the panel. */}
        <div ref={bodyRef} data-no-drag style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '12px 16px', cursor: 'auto' }}>
          {(() => {
            if (editor) {
              if (!(canTag || editor.kind === 'edit')) return <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.5)', fontStyle: 'italic', textAlign: 'center' }}>Tagging is for this replay’s owner and their teams.</div>;
              if (!signedIn && editor.kind !== 'edit') return <SignInToTagCta replaySlug={replaySlug} compact />;
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
                    {editor.kind === 'edit' ? 'Editing your comment' : editor.kind === 'reply' ? `Replying to ${active?.authorName || 'this comment'}` : `Tagging frame ${currentIndex + 1} as ${authorName}`}
                  </div>
                  <textarea value={draft} autoFocus rows={3} onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit(); }}
                    placeholder={editor.kind === 'reply' ? 'Your reply…' : 'Your note about this moment…'}
                    style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(0,0,0,0.35)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, padding: 8, fontSize: 13.5, fontFamily: 'inherit', resize: 'vertical' }} />
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" onClick={() => { setEditor(null); setDraft(''); }} style={ghostBtn}>Cancel</button>
                    <button type="button" onClick={submit} disabled={busy || !draft.trim()} style={{ ...primaryBtn, opacity: busy || !draft.trim() ? 0.5 : 1 }}>{busy ? 'Saving…' : editor.kind === 'reply' ? 'Reply' : 'Save'}</button>
                  </div>
                </div>
              );
            }
            if (!active) return <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.55)', fontSize: 13, padding: '4px 0' }}>No tags on this frame</div>;
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto', background: authorColor(active.authorName || 'anon') }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: authorColor(active.authorName || 'anon') }}>{active.authorName || 'Anonymous'}</span>
                </div>
                <div style={{ fontSize: 14.5, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'rgba(255,255,255,0.92)' }}>{active.comment}</div>
                {(replies.get(active.id) ?? []).map((r) => (
                  <div key={r.id} style={{ marginLeft: 8, paddingLeft: 9, borderLeft: `2px solid ${authorColor(r.authorName || 'anon')}`, marginTop: 2 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: authorColor(r.authorName || 'anon') }}>{r.authorName || 'Anonymous'}: </span>
                    <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)' }}>{r.comment}</span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

        {/* Control bar: prev · [add][reply][edit] · next. Wraps as a safety on very
            narrow panels; extra right/bottom pad leaves a gutter for the grip. */}
        <div style={{ flex: '0 0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, rowGap: 8, padding: '8px 22px 12px 10px', borderTop: '1px solid rgba(255,255,255,0.12)' }}>
          <NavBtn dir="prev" tag={prev} onClick={() => prev && onJump(prev.frameIndex)} />
          <div style={{ flex: '1 1 auto', display: 'flex', justifyContent: 'center', gap: 6 }}>
            <IconBtn label="Add tag" glyph="＋" onClick={() => openEditor({ kind: 'add' })} disabled={!canTag} active={editor?.kind === 'add'} />
            <IconBtn label="Reply" glyph="↩" onClick={() => active && openEditor({ kind: 'reply', id: active.id })} disabled={!canTag || !active} active={editor?.kind === 'reply'} />
            <IconBtn label="Edit" glyph="✎" onClick={() => active && openEditor({ kind: 'edit', id: active.id }, active.comment)} disabled={!active || !isMine(active)} active={editor?.kind === 'edit'} />
          </div>
          <NavBtn dir="next" tag={next} onClick={() => next && onJump(next.frameIndex)} />
        </div>

        {/* Resize grip — tucked inside the rounded corner so it isn't clipped. */}
        <div data-no-drag data-testid="taghud-resize" onPointerDown={onResizeDown} title="Resize" aria-label="Resize"
          style={{ position: 'absolute', right: 7, bottom: 7, width: 14, height: 14, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', cursor: 'nwse-resize', touchAction: 'none', color: 'rgba(255,255,255,0.6)', zIndex: 4 }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden>
            <line x1="11" y1="3" x2="3" y2="11" /><line x1="11" y1="7" x2="7" y2="11" />
          </svg>
        </div>
      </div>
      )}
    </div>
  );
}

// The minimized pill — a slim row (author + shortened text + prev/next + expand),
// still draggable, so the HUD gets out of the way of the board.
function MiniRow({ onDown, active, currentIndex, prev, next, onJump, onExpand }: {
  onDown: (e: React.PointerEvent) => void; active: ViewerTag | null; currentIndex: number;
  prev: ViewerTag | null; next: ViewerTag | null; onJump: (f: number) => void; onExpand: () => void;
}) {
  const label = active ? `${active.authorName || 'Anon'}: ${truncate(active.comment, 30)}` : `Frame ${currentIndex + 1} · no tags`;
  const mini = (content: React.ReactNode, onClick: () => void, title: string, disabled?: boolean) => (
    <button type="button" onClick={onClick} disabled={disabled} title={title} aria-label={title}
      style={{ flex: '0 0 auto', width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.16)', color: disabled ? 'rgba(255,255,255,0.3)' : '#eef2f8', cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit' }}>{content}</button>
  );
  return (
    // The WHOLE pill is a drag handle (buttons opt out via the onDown guard).
    <div data-testid="taghud-drag" onPointerDown={onDown} style={{ ...GLASS, borderRadius: 999, pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px 6px 10px', color: '#eef2f8', fontFamily: 'var(--font-barlow), sans-serif', cursor: 'grab', touchAction: 'none' }}>
      <span aria-hidden style={{ flex: '0 0 auto', color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>⠿</span>
      <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: active ? '#eef2f8' : 'rgba(255,255,255,0.55)' }}>{label}</span>
      {mini('«', () => prev && onJump(prev.frameIndex), 'Previous tag', !prev)}
      {mini('»', () => next && onJump(next.frameIndex), 'Next tag', !next)}
      {mini(<ExpandIcon />, onExpand, 'Expand')}
    </div>
  );
}

// Diagonal "maximize" arrows — reads unambiguously as expand.
function ExpandIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

// Tag-to-tag nav — a simple "Prev tag" / "Next tag" (double-chevron so it's not
// mistaken for the single-chevron frame stepper). No preview.
function NavBtn({ dir, tag, onClick }: { dir: 'prev' | 'next'; tag: ViewerTag | null; onClick: () => void }) {
  const disabled = !tag;
  const label = dir === 'prev' ? 'Prev tag' : 'Next tag';
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={disabled ? undefined : (dir === 'prev' ? 'Previous tagged frame' : 'Next tagged frame')}
      style={{
        flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 5,
        background: disabled ? 'transparent' : 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
        color: disabled ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.85)', borderRadius: 8, padding: '6px 11px',
        fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: disabled ? 'default' : 'pointer', whiteSpace: 'nowrap',
      }}>
      {dir === 'prev' ? <><span aria-hidden style={{ fontWeight: 800 }}>«</span> {label}</> : <>{label} <span aria-hidden style={{ fontWeight: 800 }}>»</span></>}
    </button>
  );
}

function IconBtn({ label, glyph, onClick, disabled, active }: { label: string; glyph: string; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label}
      style={{
        width: 34, height: 34, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
        background: active ? 'rgba(77,210,255,0.28)' : 'rgba(255,255,255,0.08)', border: `1px solid ${active ? tokens.led.on : 'rgba(255,255,255,0.16)'}`,
        color: disabled ? 'rgba(255,255,255,0.3)' : '#eef2f8', cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit',
      }}>
      <span aria-hidden>{glyph}</span>
    </button>
  );
}

const ghostBtn: React.CSSProperties = { background: 'transparent', border: 0, color: 'rgba(255,255,255,0.7)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
const primaryBtn: React.CSSProperties = { background: 'rgba(77,157,255,0.28)', color: '#dbeafe', border: '1px solid rgba(120,180,255,0.6)', borderRadius: 8, padding: '5px 14px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' };
