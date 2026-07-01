'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tokens } from '@/app/_theme/karabuddyTokens';

// B216 redesign — the Game Log feature. Shows the WHOLE karabast log so you can
// scroll ahead; the "active" line (the most recent event at or before the current
// frame — always lit, even when the frame sits between log events) marks the
// playhead. Past is dimmed, the future dimmed more. When you scroll past the
// active line it pins to the top/bottom edge; tap it to snap back.

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
  const activeRef = useRef<HTMLButtonElement>(null);
  const [pin, setPin] = useState<'top' | 'bottom' | null>(null);

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

  // The most recent frame WITH log lines at or before the playhead — always a real
  // event line, so it stays lit even on a frame that sits between log events.
  const activeFrame = useMemo(() => {
    if (!messagesByFrame) return -1;
    for (let i = Math.min(currentIndex, messagesByFrame.length - 1); i >= 0; i--) {
      if ((messagesByFrame[i]?.length ?? 0) > 0) return i;
    }
    return -1;
  }, [messagesByFrame, currentIndex]);

  const entries = useMemo(() => {
    if (!messagesByFrame) return [];
    const out: { frame: number; msg: any; state: 'past' | 'current' | 'future' }[] = [];
    for (let i = 0; i < messagesByFrame.length; i++) {
      const state = i === activeFrame ? 'current' : i < activeFrame ? 'past' : 'future';
      for (const msg of messagesByFrame[i] || []) out.push({ frame: i, msg, state });
    }
    return out;
  }, [messagesByFrame, activeFrame]);
  const activeAnchorIdx = useMemo(() => entries.findIndex((e) => e.frame === activeFrame), [entries, activeFrame]);
  const activeEntry = activeAnchorIdx >= 0 ? entries[activeAnchorIdx] : null;

  // Is the active line above / below / within the viewport → pin its edge.
  const evalPin = useCallback(() => {
    const c = scrollRef.current, r = activeRef.current;
    if (!c || !r) { setPin(null); return; }
    const cr = c.getBoundingClientRect(), rr = r.getBoundingClientRect();
    if (rr.bottom < cr.top + 6) setPin('top');
    else if (rr.top > cr.bottom - 6) setPin('bottom');
    else setPin(null);
  }, []);

  const scrollToActive = useCallback(() => {
    const c = scrollRef.current, r = activeRef.current;
    if (!c || !r) return;
    const cr = c.getBoundingClientRect(), rr = r.getBoundingClientRect();
    c.scrollTop += (rr.top - cr.top) - c.clientHeight / 2 + rr.height / 2;
    setPin(null);
  }, []);

  // Re-center the active line when the playhead crosses to a new event.
  useEffect(() => { scrollToActive(); }, [activeFrame, scrollToActive]);

  if (entries.length === 0) {
    return <div style={{ padding: '28px 18px', textAlign: 'center', color: tokens.color.textMuted, fontSize: 13 }}>No log entries yet.</div>;
  }

  const pinnedBar = pin && activeEntry && (
    <button type="button" onClick={scrollToActive} title="Back to the current line" data-testid="log-pinned"
      style={{ position: 'absolute', left: 10, right: 10, ...(pin === 'top' ? { top: 8 } : { bottom: 8 }), zIndex: 6, display: 'flex', gap: 9, alignItems: 'center', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
        padding: '7px 11px', borderRadius: 9, border: `1px solid ${tokens.led.on}`, background: 'rgba(14,19,28,0.9)', backdropFilter: 'blur(14px) saturate(1.3)', WebkitBackdropFilter: 'blur(14px) saturate(1.3)', color: tokens.color.text, boxShadow: '0 6px 20px rgba(0,0,0,0.5)', fontSize: 13, lineHeight: 1.4 }}>
      <span aria-hidden style={{ flex: '0 0 auto', minWidth: 20, textAlign: 'right', fontSize: 10, fontWeight: 700, color: tokens.led.on, fontVariantNumeric: 'tabular-nums' }}>{activeEntry.frame + 1}</span>
      <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{renderMessage(activeEntry.msg, colorMap)}</span>
      <span aria-hidden style={{ flex: '0 0 auto', color: tokens.led.on, fontSize: 14, fontWeight: 800 }}>{pin === 'top' ? '↑' : '↓'}</span>
    </button>
  );

  return (
    <div style={{ position: 'relative', height: '100%' }}>
      {pinnedBar}
      <div ref={scrollRef} onScroll={evalPin} style={{ height: '100%', overflowY: 'auto', scrollbarGutter: 'stable', padding: '12px 12px 24px', display: 'flex', flexDirection: 'column', gap: 2, fontSize: 13, lineHeight: 1.45 }}>
        <style>{'.kb-log-line{background:transparent;transition:background 120ms}.kb-log-line:hover{background:rgba(255,255,255,0.06)}'}</style>
        {entries.map((e, idx) => {
          const isCurrent = e.state === 'current';
          const op = isCurrent ? 1 : e.state === 'past' ? 0.5 : 0.26; // future dimmed more than past
          return (
            <button key={`${e.frame}-${idx}`} ref={idx === activeAnchorIdx ? activeRef : null} type="button" className="kb-log-line"
              title={`Jump to frame ${e.frame + 1}`} onClick={() => onJump(e.frame)}
              style={{ display: 'flex', gap: 9, alignItems: 'baseline', width: '100%', textAlign: 'left', border: 0, borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.45, color: isCurrent ? tokens.color.text : tokens.color.textSecondary, opacity: op, transition: 'opacity 120ms ease' }}>
              <span aria-hidden style={{ flex: '0 0 auto', minWidth: 20, textAlign: 'right', fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.26)', fontVariantNumeric: 'tabular-nums' }}>{e.frame + 1}</span>
              <span style={{ flex: '1 1 auto' }}>{renderMessage(e.msg, colorMap)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
