'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { tokens } from '@/app/_theme/karabuddyTokens';

// B216 redesign — the Game Log feature (second feature on the rail, proving the
// pattern generalizes). Cumulative karabast log up to the current frame, with the
// current frame's lines highlighted; same data the old sidebar used
// (messagesByFrame), just rehomed into a FeaturePanel so it reads well on mobile
// (full-screen) and desktop (dock) without a separate view-model.

const PLAYER_COLORS = ['#5db4ff', '#ff9f4d'];

function renderMessage(msg: any, color: Map<string, string>): React.ReactNode {
  if (!msg) return null;
  if (typeof msg === 'string') return msg;
  if (!Array.isArray(msg.message)) return null;
  return msg.message.map((part: any, i: number) => {
    if (typeof part === 'string') return <React.Fragment key={i}>{part}</React.Fragment>;
    const name = part?.name ?? '';
    if (!name) return null;
    const c = part?.type === 'player' ? color.get(part.id) : null;
    return c ? <span key={i} style={{ color: c, fontWeight: 600 }}>{name}</span> : <React.Fragment key={i}>{name}</React.Fragment>;
  });
}

export function GameLogFeature({ messagesByFrame, currentIndex, onJump }: {
  messagesByFrame: any[][] | null;
  currentIndex: number;
  onJump: (frame: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLButtonElement>(null);

  // Assign a stable color per player id, in first-seen order.
  const colorMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const frame of messagesByFrame ?? []) {
      for (const msg of frame ?? []) {
        if (msg && Array.isArray(msg.message)) {
          for (const part of msg.message) {
            if (part?.type === 'player' && part.id && !m.has(part.id)) m.set(part.id, PLAYER_COLORS[m.size % PLAYER_COLORS.length]);
          }
        }
      }
    }
    return m;
  }, [messagesByFrame]);

  const entries = useMemo(() => {
    if (!messagesByFrame) return [];
    const out: { frame: number; msg: any; current: boolean }[] = [];
    const upTo = Math.min(currentIndex, messagesByFrame.length - 1);
    for (let i = 0; i <= upTo; i++) {
      for (const msg of messagesByFrame[i] || []) out.push({ frame: i, msg, current: i === currentIndex });
    }
    return out;
  }, [messagesByFrame, currentIndex]);

  // Keep the current frame's lines in view as you scrub.
  useEffect(() => {
    const c = scrollRef.current; if (!c) return;
    const row = currentRef.current;
    if (row) { const cr = c.getBoundingClientRect(), rr = row.getBoundingClientRect(); c.scrollTop += (rr.top - cr.top) - c.clientHeight / 2 + rr.height / 2; }
    else c.scrollTop = c.scrollHeight;
  }, [entries]);

  if (entries.length === 0) {
    return <div style={{ padding: '28px 18px', textAlign: 'center', color: tokens.color.textMuted, fontSize: 13 }}>No log entries yet at this frame.</div>;
  }

  return (
    <div ref={scrollRef} style={{ height: '100%', overflowY: 'auto', scrollbarGutter: 'stable', padding: '12px 12px 24px', display: 'flex', flexDirection: 'column', gap: 2, fontSize: 13, lineHeight: 1.45 }}>
      <style>{'.kb-log-line{background:transparent;transition:background 120ms}.kb-log-line:hover{background:rgba(255,255,255,0.06)}'}</style>
      {entries.map((e, idx) => {
        const firstCurrent = e.current && (idx === 0 || !entries[idx - 1].current);
        return (
          <button key={`${e.frame}-${idx}`} ref={firstCurrent ? currentRef : null} type="button" className="kb-log-line"
            title={`Jump to frame ${e.frame + 1}`} onClick={() => onJump(e.frame)}
            style={{ display: 'flex', gap: 9, alignItems: 'baseline', width: '100%', textAlign: 'left', border: 0, borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.45, color: e.current ? tokens.color.text : tokens.color.textSecondary, opacity: e.current ? 1 : 0.5, transition: 'opacity 120ms ease' }}>
            <span aria-hidden style={{ flex: '0 0 auto', minWidth: 20, textAlign: 'right', fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.26)', fontVariantNumeric: 'tabular-nums' }}>{e.frame + 1}</span>
            <span style={{ flex: '1 1 auto' }}>{renderMessage(e.msg, colorMap)}</span>
          </button>
        );
      })}
    </div>
  );
}
