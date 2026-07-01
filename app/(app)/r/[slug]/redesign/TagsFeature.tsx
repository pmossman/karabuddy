'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { getOrCreateInstallToken } from '@/lib/installToken';
import { scopeLabel } from '@/lib/commentScope';
import { tokens } from '@/app/_theme/karabuddyTokens';

// B216 redesign — the Tags FEED: a condensed, chronological list of every tag on
// the replay (top = start of the game, bottom = end). It is NOT the compose/act
// surface (that's the board HUD) — it's a browse/overview timeline. The current
// frame's tag(s) are lit; every other tag is dimmed equally (before AND after),
// so the feed reads like a playhead moving down the game. Click a row to jump.

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
export function authorColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

const DIM = 0.42; // uniform fade for every non-current tag

export function TagsFeature({ tags, currentIndex, onJump, armedTeams = [], lastViewedAt = null }: {
  tags: ViewerTag[];
  currentIndex: number;
  onJump: (frame: number) => void;
  armedTeams?: { slug: string; name: string }[];
  lastViewedAt?: string | null;
}) {
  const { data: session } = useSession();
  const myUserId = (session?.user as { id?: string } | undefined)?.id || null;
  const [token] = useState(() => (typeof window !== 'undefined' ? getOrCreateInstallToken() : ''));
  const isMine = (t: ViewerTag) => (!!myUserId && t.userId === myUserId) || (!!token && !!t.authorToken && t.authorToken === token);
  const isNew = (t: ViewerTag) => !!lastViewedAt && !isMine(t) && t.createdAt > lastViewedAt;
  const armedSlugs = useMemo(() => armedTeams.map((a) => a.slug), [armedTeams]);
  const teamNames = useMemo(() => Object.fromEntries(armedTeams.map((a) => [a.slug, a.name])), [armedTeams]);

  const { rows, replyMap, total } = useMemo(() => {
    const top = tags.filter((t) => !t.parentTagId).sort((a, b) => a.frameIndex - b.frameIndex || (a.createdAt < b.createdAt ? -1 : 1));
    const replyMap = new Map<string, ViewerTag[]>();
    for (const t of tags) if (t.parentTagId) { const a = replyMap.get(t.parentTagId) ?? []; a.push(t); replyMap.set(t.parentTagId, a); }
    return { rows: top, replyMap, total: top.length };
  }, [tags]);

  // Keep the current frame's tag in view as you scrub — the feed tracks the playhead.
  const currentRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { currentRef.current?.scrollIntoView({ block: 'nearest' }); }, [currentIndex, total]);

  if (total === 0) {
    return <div style={{ padding: '24px 16px', textAlign: 'center', color: tokens.color.textMuted, fontSize: 13 }}>No tags on this replay yet.</div>;
  }

  let seenCurrent = false;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 12px 24px' }}>
      {rows.map((t) => {
        const isCurrent = t.frameIndex === currentIndex;
        const first = isCurrent && !seenCurrent; if (isCurrent) seenCurrent = true;
        const color = authorColor(t.authorName || 'anon');
        const replies = replyMap.get(t.id) ?? [];
        return (
          <button key={t.id} type="button" ref={first ? currentRef : undefined} onClick={() => onJump(t.frameIndex)} title={`Jump to frame ${t.frameIndex + 1}`}
            style={{
              textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4, width: '100%',
              padding: '8px 10px', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit',
              borderLeft: `3px solid ${color}`,
              border: `1px solid ${isCurrent ? 'rgba(77,210,255,0.5)' : 'transparent'}`,
              borderLeftColor: color,
              background: isCurrent ? 'rgba(77,210,255,0.10)' : 'transparent',
              opacity: isCurrent ? 1 : DIM,
              transition: 'opacity 120ms',
            }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flex: '0 0 auto' }} />
              <span style={{ fontSize: 12.5, fontWeight: 700, color: '#e8ecf3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.authorName || 'Anonymous'}</span>
              {isNew(t) && <span aria-hidden style={{ flex: '0 0 auto', background: 'rgba(86,199,255,0.18)', border: '1px solid rgba(86,199,255,0.5)', color: '#8fd6ff', borderRadius: 999, padding: '0 6px', fontSize: 9, fontWeight: 800, letterSpacing: '0.05em' }}>NEW</span>}
              <span style={{ marginLeft: 'auto', flex: '0 0 auto', fontSize: 10.5, fontWeight: 700, color: isCurrent ? tokens.color.accent : tokens.color.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Frame {t.frameIndex + 1}</span>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.4, color: tokens.color.text, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word' }}>{t.comment || '(no text)'}</div>
            {isMine(t) && <div style={{ fontSize: 10, color: tokens.color.textFaint }}>Visible to {scopeLabel(t.scope ?? [], armedSlugs, teamNames)}</div>}
            {replies.map((r) => (
              <div key={r.id} style={{ display: 'flex', gap: 5, fontSize: 11.5, color: tokens.color.textSecondary, paddingLeft: 4 }}>
                <span aria-hidden style={{ color: tokens.color.textMuted }}>↳</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><b style={{ color: '#cdd4df', fontWeight: 700 }}>{r.authorName || 'Anon'}:</b> {r.comment}</span>
              </div>
            ))}
          </button>
        );
      })}
    </div>
  );
}
