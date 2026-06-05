'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { Chapter, ChapterKind } from '@/lib/replayChapters';

// B106: "jump to a moment" navigator. A round bubble (bottom-left of the board)
// that opens a compact timeline of the game's beats — each round, each leader
// flip, your tags, and the end — so you can skip straight to a turn instead of
// holding the arrow or hand-editing the ?f= URL. Tap a beat to jump there.

const ACCENT = '#4d9dff';

const KIND_COLOR: Record<ChapterKind, string> = {
  start: '#8b93a5',
  round: ACCENT,
  leader: '#e0c64a',
  tag: '#6bd968',
  end: '#e07a5f',
};

export function JumpToMenu({
  chapters,
  currentIndex,
  onJump,
  bottom,
  right,
}: {
  chapters: Chapter[];
  currentIndex: number;
  onJump: (frameIndex: number) => void;
  bottom: string;
  right: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  // The active beat = the last one at or before the current frame.
  let activeIdx = 0;
  for (let i = 0; i < chapters.length; i++) if (chapters[i].frameIndex <= currentIndex) activeIdx = i;

  // Scroll the active row into view when the menu opens.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView({ block: 'center' });
  }, [open]);

  if (chapters.length <= 1) return null;

  return (
    <div
      ref={wrapRef}
      style={{ position: 'fixed', bottom, right, zIndex: 90 }}
    >
      {open && (
        <div
          role="dialog"
          aria-label="Jump to a moment"
          style={{
            position: 'absolute', bottom: 'calc(100% + 10px)', right: 0,
            width: 248, maxHeight: 'min(56vh, 420px)', display: 'flex', flexDirection: 'column',
            background: 'rgba(17, 20, 26, 0.98)', border: `1px solid ${ACCENT}55`,
            borderRadius: 12, boxShadow: '0 6px 22px rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)',
            overflow: 'hidden',
            fontFamily: 'var(--font-barlow), -apple-system, sans-serif',
          }}
        >
          <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid #2a2f3a', flex: '0 0 auto' }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#8b93a5' }}>
              Jump to
            </span>
          </div>
          <div ref={listRef} style={{ overflowY: 'auto', padding: '6px 6px 8px' }}>
            {chapters.map((c, i) => {
              const active = i === activeIdx;
              const last = i === chapters.length - 1;
              return (
                <button
                  key={`${c.frameIndex}-${c.kind}-${i}`}
                  type="button"
                  data-active={active ? 'true' : undefined}
                  onClick={() => { onJump(c.frameIndex); setOpen(false); }}
                  style={{
                    display: 'grid', gridTemplateColumns: '16px 1fr', gap: 8, alignItems: 'stretch',
                    width: '100%', textAlign: 'left', border: 0, cursor: 'pointer',
                    background: active ? `${ACCENT}22` : 'transparent',
                    borderRadius: 7, padding: '7px 8px',
                    fontFamily: 'inherit',
                  }}
                >
                  {/* Rail: a connecting line behind a kind-colored dot. */}
                  <span style={{ position: 'relative', width: 16, alignSelf: 'stretch' }} aria-hidden="true">
                    <span style={{ position: 'absolute', left: 7, top: i === 0 ? '50%' : 0, bottom: last ? '50%' : 0, width: 2, background: '#2e333c' }} />
                    <span style={{
                      position: 'absolute', left: 3, top: 'calc(50% - 5px)', width: 10, height: 10, borderRadius: '50%',
                      background: active ? KIND_COLOR[c.kind] : '#11141a',
                      border: `2px solid ${KIND_COLOR[c.kind]}`,
                    }} />
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{
                      fontSize: 12.5, fontWeight: active ? 800 : 600,
                      color: active ? '#fff' : '#d4d9e2',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {c.kind === 'tag' ? '“' + c.label + '”' : c.label}
                    </span>
                    {c.sublabel && (
                      <span style={{ fontSize: 10.5, color: '#8b93a5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.sublabel}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Jump to a moment"
        aria-expanded={open}
        title="Jump to a moment"
        style={{
          width: 38, height: 38, borderRadius: '50%', padding: 0, cursor: 'pointer',
          background: open ? 'rgba(77, 157, 255, 0.32)' : 'rgba(36, 48, 68, 0.85)',
          color: '#d6e7ff', border: '1px solid rgba(77, 157, 255, 0.4)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 160ms ease',
        }}
      >
        <ChaptersGlyph />
      </button>
    </div>
  );
}

// Map-pin / location-marker glyph — reads as "navigate / jump to a spot".
function ChaptersGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21.5s-6.5-5.6-6.5-10.5a6.5 6.5 0 1 1 13 0c0 4.9-6.5 10.5-6.5 10.5Z" />
      <circle cx="12" cy="11" r="2.3" />
    </svg>
  );
}
