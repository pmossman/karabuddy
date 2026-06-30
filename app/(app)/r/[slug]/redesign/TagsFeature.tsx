'use client';

import { useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { getOrCreateInstallToken } from '@/lib/installToken';
import { tokens } from '@/app/_theme/karabuddyTokens';

// B216 redesign — the Tags feature, designed to be READABLE at any size. The old
// mobile tag strip was a cramped, tiny scroll area; here tags are roomy cards in
// one scroll, grouped This frame / Upcoming / Previous, so you can read several
// at once (especially full-screen on mobile). Reuses the viewer's already-fetched
// `tags` (no new data path). Read-only for this first cut — compose lands next.

export interface ViewerTag {
  id: string;
  frameIndex: number;
  userId?: string | null;
  authorToken?: string;
  authorName: string;
  comment: string;
  createdAt: string;
  scope?: string[];
  parentTagId?: string | null;
}

const COLORS = ['#4dd2ff', '#6bd968', '#e0c64a', '#ff8a7a', '#c08bff', '#5db4ff', '#ff9f4d'];
function authorColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); if (d < 30) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
}

function TagCard({ tag, replies, onJump, isCurrent }: { tag: ViewerTag; replies: ViewerTag[]; onJump: (frame: number) => void; isCurrent: boolean }) {
  const color = authorColor(tag.authorName || 'anon');
  return (
    <div style={{
      border: `1px solid ${isCurrent ? 'rgba(77,210,255,0.5)' : tokens.color.border}`,
      borderLeft: `3px solid ${color}`,
      borderRadius: 10,
      background: isCurrent ? 'rgba(77,210,255,0.06)' : tokens.color.surface,
      padding: '11px 13px',
      display: 'flex', flexDirection: 'column', gap: 7,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flex: '0 0 auto' }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: '#e8ecf3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag.authorName || 'Anonymous'}</span>
        <span style={{ fontSize: 11, color: tokens.color.textMuted, flex: '0 0 auto' }}>{relativeTime(tag.createdAt)}</span>
        <button type="button" onClick={() => onJump(tag.frameIndex)} title="Jump to this frame"
          style={{ marginLeft: 'auto', flex: '0 0 auto', background: 'transparent', border: `1px solid ${tokens.color.border}`, color: tokens.color.accent, borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          Frame {tag.frameIndex + 1} ↗
        </button>
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.45, color: tokens.color.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{tag.comment || <em style={{ color: tokens.color.textMuted }}>(no text)</em>}</div>
      {tag.scope && tag.scope.length > 0 && (
        <div style={{ fontSize: 10.5, color: tokens.color.textMuted }}>Visible to {tag.scope.join(', ')}</div>
      )}
      {replies.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2, paddingLeft: 10, borderLeft: `1px solid ${tokens.color.border}` }}>
          {replies.map((r) => (
            <div key={r.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: authorColor(r.authorName || 'anon') }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: '#cdd4df' }}>{r.authorName || 'Anonymous'}</span>
                <span style={{ fontSize: 10.5, color: tokens.color.textMuted }}>{relativeTime(r.createdAt)}</span>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.4, color: tokens.color.textSecondary, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{r.comment}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Group({ label, count, tags, replyMap, onJump, currentIndex, dim }: {
  label: string; count: number; tags: ViewerTag[]; replyMap: Map<string, ViewerTag[]>;
  onJump: (frame: number) => void; currentIndex: number; dim?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: dim ? tokens.color.textFaint : tokens.color.textMuted }}>{label} {count > 0 && <span style={{ opacity: 0.7 }}>({count})</span>}</div>
      {tags.length === 0
        ? <div style={{ fontSize: 12, color: tokens.color.textFaint, fontStyle: 'italic' }}>Nothing here.</div>
        : tags.map((t) => <TagCard key={t.id} tag={t} replies={replyMap.get(t.id) ?? []} onJump={onJump} isCurrent={t.frameIndex === currentIndex} />)}
    </div>
  );
}

// Compose a new tag at the current frame. Signed-out → the same "sign in to tag"
// gate we ship in prod (anonymous tags can't become reviews). Signed-in → a
// textarea that POSTs and optimistically appends (in ORIGINAL frame space, so
// the viewer's collapsed-frame remap places it correctly — mirrors TagSidebar).
function Composer({ replaySlug, currentIndex, toOriginalFrame, appendTag }: {
  replaySlug: string; currentIndex: number; toOriginalFrame: (i: number) => number; appendTag: (t: ViewerTag) => void;
}) {
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id || null;
  const authorName = session?.user?.name || 'You';
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  if (!userId) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, background: tokens.color.primarySoft, border: `1px solid rgba(77,157,255,0.3)`, borderRadius: 8, textAlign: 'center' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#cfe3ff' }}>Sign in to tag this replay</span>
        <span style={{ fontSize: 11, color: tokens.color.textSecondary, lineHeight: 1.4 }}>Tags are tied to your account so they count and can be submitted as a review.</span>
        <a href={`/signin?callbackUrl=${encodeURIComponent(`/r/${replaySlug}`)}`}
          style={{ alignSelf: 'center', marginTop: 2, background: 'rgba(77,157,255,0.16)', color: '#9fc4ff', border: '1px solid rgba(77,157,255,0.45)', borderRadius: 6, padding: '6px 16px', fontSize: 12.5, fontWeight: 700, textDecoration: 'none' }}>Sign in →</a>
      </div>
    );
  }

  const submit = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    const token = getOrCreateInstallToken();
    const origFrame = toOriginalFrame(currentIndex);
    try {
      const res = await fetch(`/api/replays/${replaySlug}/tags`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Install-Token': token } : {}) },
        body: JSON.stringify({ installToken: token, authorName, frameIndex: origFrame, comment: text }),
      });
      const body = await res.json();
      if (!body.ok) { alert(`Failed to add tag: ${body.error || 'unknown'}`); return; }
      appendTag({ id: body.id, frameIndex: origFrame, authorToken: token, authorName, comment: text, createdAt: new Date().toISOString(), scope: body.scope ?? [], parentTagId: null });
      setDraft(''); setOpen(false);
    } catch { alert('Network error adding tag.'); }
    finally { setBusy(false); }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        style={{ width: '100%', background: 'transparent', border: `1px solid ${tokens.color.primary}`, color: tokens.color.primary, borderRadius: 8, padding: '9px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
        + Tag this frame
      </button>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10, background: tokens.color.primarySoft, border: '1px solid rgba(77,157,255,0.3)', borderRadius: 8 }}>
      <div style={{ fontSize: 11, color: tokens.color.textSecondary }}>Tagging frame {currentIndex + 1} as {authorName}</div>
      <textarea value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus rows={3}
        placeholder="Your note about this moment…"
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit(); }}
        style={{ width: '100%', boxSizing: 'border-box', background: tokens.color.bg, color: tokens.color.text, border: `1px solid ${tokens.color.border}`, borderRadius: 6, padding: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={() => { setOpen(false); setDraft(''); }} style={{ background: 'transparent', border: 0, color: tokens.color.textSecondary, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
        <button type="button" onClick={submit} disabled={busy || !draft.trim()} style={{ background: 'rgba(77,157,255,0.16)', color: tokens.color.primary, border: `1px solid ${tokens.color.primary}`, borderRadius: 6, padding: '5px 14px', fontSize: 12.5, fontWeight: 800, cursor: busy || !draft.trim() ? 'default' : 'pointer', opacity: busy || !draft.trim() ? 0.5 : 1, fontFamily: 'inherit' }}>{busy ? 'Saving…' : 'Save tag'}</button>
      </div>
    </div>
  );
}

export function TagsFeature({ tags, currentIndex, onJump, replaySlug, toOriginalFrame, appendTag }: {
  tags: ViewerTag[];
  currentIndex: number;
  onJump: (frame: number) => void;
  replaySlug: string;
  toOriginalFrame: (i: number) => number;
  appendTag: (t: ViewerTag) => void;
}) {
  const { current, upcoming, previous, replyMap, total } = useMemo(() => {
    const top = tags.filter((t) => !t.parentTagId);
    const replyMap = new Map<string, ViewerTag[]>();
    for (const t of tags) {
      if (t.parentTagId) { const a = replyMap.get(t.parentTagId) ?? []; a.push(t); replyMap.set(t.parentTagId, a); }
    }
    return {
      current: top.filter((t) => t.frameIndex === currentIndex),
      upcoming: top.filter((t) => t.frameIndex > currentIndex).sort((a, b) => a.frameIndex - b.frameIndex),
      previous: top.filter((t) => t.frameIndex < currentIndex).sort((a, b) => b.frameIndex - a.frameIndex),
      replyMap,
      total: top.length,
    };
  }, [tags, currentIndex]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '14px 14px 28px' }}>
      <Composer replaySlug={replaySlug} currentIndex={currentIndex} toOriginalFrame={toOriginalFrame} appendTag={appendTag} />
      {total === 0 ? (
        <div style={{ padding: '20px 0', textAlign: 'center', color: tokens.color.textMuted, fontSize: 13 }}>No tags on this replay yet — add the first above.</div>
      ) : (
        <>
          {current.length > 0 && <Group label="This frame" count={current.length} tags={current} replyMap={replyMap} onJump={onJump} currentIndex={currentIndex} />}
          <Group label="Upcoming" count={upcoming.length} tags={upcoming} replyMap={replyMap} onJump={onJump} currentIndex={currentIndex} />
          <Group label="Previous" count={previous.length} tags={previous} replyMap={replyMap} onJump={onJump} currentIndex={currentIndex} dim />
        </>
      )}
    </div>
  );
}
