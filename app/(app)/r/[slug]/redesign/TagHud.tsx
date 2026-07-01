'use client';

import { useMemo, useState } from 'react';
import { tokens } from '@/app/_theme/karabuddyTokens';
import type { ViewerTag } from './TagsFeature';
import { useCreateTag, SignInToTagCta } from './tagCompose';

// B216 redesign — the Tag HUD: a glassy, iOS-style bubble floating over the
// CENTRE of the board (both desktop + mobile) showing the CURRENT frame's tag(s)
// with minimal controls — add, reply, and prev/next-tag nav with a shortened
// preview. The full feed lives elsewhere (desktop sidebar / mobile full-page).
// Translucent so the board reads through it.

const truncate = (s: string, n = 22) => { const t = (s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

const GLASS: React.CSSProperties = {
  background: 'rgba(16, 20, 28, 0.55)',
  backdropFilter: 'blur(20px) saturate(1.4)',
  WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
  border: '1px solid rgba(255,255,255,0.14)',
  boxShadow: '0 12px 44px rgba(0,0,0,0.5)',
};

export function TagHud({ tags, currentIndex, onJump, replaySlug, toOriginalFrame, appendTag, canTag, sidebarW = 0, onOpenFeed }: {
  tags: ViewerTag[];
  currentIndex: number;
  onJump: (frame: number) => void;
  replaySlug: string;
  toOriginalFrame: (i: number) => number;
  appendTag: (t: ViewerTag) => void;
  canTag: boolean;
  sidebarW?: number; // desktop feed width — shift the HUD to centre on the board
  onOpenFeed?: () => void; // "see all tags" (mobile full-page / desktop focuses sidebar)
}) {
  const { signedIn, authorName, create } = useCreateTag(replaySlug, toOriginalFrame, appendTag);
  const [compose, setCompose] = useState<null | { replyTo?: string }>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const top = useMemo(() => tags.filter((t) => !t.parentTagId).sort((a, b) => a.frameIndex - b.frameIndex), [tags]);
  const here = useMemo(() => top.filter((t) => t.frameIndex === currentIndex), [top, currentIndex]);
  const prev = useMemo(() => [...top].reverse().find((t) => t.frameIndex < currentIndex) || null, [top, currentIndex]);
  const next = useMemo(() => top.find((t) => t.frameIndex > currentIndex) || null, [top, currentIndex]);
  const replies = useMemo(() => {
    const m = new Map<string, ViewerTag[]>();
    for (const t of tags) if (t.parentTagId) { const a = m.get(t.parentTagId) ?? []; a.push(t); m.set(t.parentTagId, a); }
    return m;
  }, [tags]);

  const submit = async () => {
    if (busy || !draft.trim() || !compose) return;
    setBusy(true);
    const ok = await create(currentIndex, draft, compose.replyTo);
    setBusy(false);
    if (ok) { setDraft(''); setCompose(null); }
  };

  return (
    <div style={{ position: 'fixed', top: '50%', left: '50%', transform: `translate(calc(-50% - ${sidebarW / 2}px), -50%)`, zIndex: 130, width: 'min(420px, 90vw)', pointerEvents: 'none' }}>
      <div style={{ ...GLASS, borderRadius: 20, pointerEvents: 'auto', display: 'flex', flexDirection: 'column', maxHeight: '54vh', overflow: 'hidden', color: '#eef2f8', fontFamily: 'var(--font-barlow), sans-serif' }}>
        {/* Body: current frame's tag(s), or a minimal empty state. */}
        <div style={{ flex: '0 1 auto', minHeight: 0, overflowY: 'auto', padding: here.length ? '14px 16px 8px' : '18px 16px' }}>
          {here.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>No tags on this frame</div>
          ) : here.map((t) => (
            <div key={t.id} style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingBottom: 8 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>{t.authorName || 'Anonymous'}</div>
              <div style={{ fontSize: 14.5, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{t.comment}</div>
              {(replies.get(t.id) ?? []).map((r) => (
                <div key={r.id} style={{ marginLeft: 8, paddingLeft: 8, borderLeft: '1px solid rgba(255,255,255,0.15)', marginTop: 2 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.65)' }}>{r.authorName || 'Anonymous'}: </span>
                  <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)' }}>{r.comment}</span>
                </div>
              ))}
            </div>
          ))}

          {/* Inline compose / reply. */}
          {compose && (canTag ? (signedIn ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: here.length ? 6 : 0 }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>{compose.replyTo ? 'Replying' : `Tagging frame ${currentIndex + 1}`} as {authorName}</div>
              <textarea value={draft} autoFocus rows={2} onChange={(e) => setDraft(e.target.value)} placeholder={compose.replyTo ? 'Your reply…' : 'Your note about this moment…'}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit(); }}
                style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(0,0,0,0.35)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, padding: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => { setCompose(null); setDraft(''); }} style={ghostBtn}>Cancel</button>
                <button type="button" onClick={submit} disabled={busy || !draft.trim()} style={{ ...primaryBtn, opacity: busy || !draft.trim() ? 0.5 : 1 }}>{busy ? 'Saving…' : compose.replyTo ? 'Reply' : 'Save'}</button>
              </div>
            </div>
          ) : <div style={{ marginTop: 8 }}><SignInToTagCta replaySlug={replaySlug} compact /></div>
          ) : <div style={{ marginTop: 8, fontSize: 11.5, color: 'rgba(255,255,255,0.5)', fontStyle: 'italic', textAlign: 'center' }}>Tagging is for this replay’s owner and their teams.</div>)}
        </div>

        {/* Control bar: prev · [add] [reply] [feed] · next. */}
        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderTop: '1px solid rgba(255,255,255,0.12)' }}>
          <NavBtn dir="prev" tag={prev} onClick={() => prev && onJump(prev.frameIndex)} />
          <div style={{ flex: '1 1 auto', display: 'flex', justifyContent: 'center', gap: 6 }}>
            <IconBtn label="Add tag" glyph="＋" onClick={() => setCompose({})} disabled={!canTag} active={!!compose && !compose.replyTo} />
            <IconBtn label="Reply" glyph="↩" onClick={() => here[0] && setCompose({ replyTo: here[0].id })} disabled={!canTag || here.length === 0} active={!!compose?.replyTo} />
            {onOpenFeed && <IconBtn label="All tags" glyph="≣" onClick={onOpenFeed} />}
          </div>
          <NavBtn dir="next" tag={next} onClick={() => next && onJump(next.frameIndex)} />
        </div>
      </div>
    </div>
  );
}

function NavBtn({ dir, tag, onClick }: { dir: 'prev' | 'next'; tag: ViewerTag | null; onClick: () => void }) {
  const arrow = dir === 'prev' ? '‹' : '›';
  const disabled = !tag;
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={tag ? `Frame ${tag.frameIndex + 1}: ${tag.comment}` : undefined}
      style={{
        flex: '0 1 auto', maxWidth: '34%', display: 'inline-flex', alignItems: 'center', gap: 4,
        background: disabled ? 'transparent' : 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)',
        color: disabled ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.9)', borderRadius: 999, padding: '6px 10px',
        fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: disabled ? 'default' : 'pointer',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
      {dir === 'prev' ? `${arrow} ${tag ? truncate(tag.comment, 14) : ''}` : `${tag ? truncate(tag.comment, 14) : ''} ${arrow}`}
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
