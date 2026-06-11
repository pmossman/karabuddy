'use client';

import React, { useEffect, useRef, useState } from 'react';
import { LedToggle } from '@/app/_components/LedToggle';

// B128: the double-sided replay controls bubble. Renders ONLY when the replay
// has both teammates' recordings (canFlip) — a round ⇄ FAB stacked in the
// bottom-right control cluster (above Jump-to-moment) that opens a small panel
// with:
//   • which player's perspective is on screen + the manual Flip control
//     (relocated here from the playback pill/bubble), and
//   • the "auto-switch" toggle — follow the active player with a fade-to-black
//     handoff whenever the action passes to the other side (hotseat-style).

export function PovBubble({
  viewLabel,
  onFlip,
  autoPov,
  onAutoPovChange,
  bottom,
  right,
}: {
  viewLabel: string;
  onFlip: () => void;
  autoPov: boolean;
  onAutoPovChange: (next: boolean) => void;
  bottom: string;
  right: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: 'fixed', bottom, right, zIndex: 90 }}>
      {open && (
        <div
          data-testid="pov-bubble-panel"
          style={{
            position: 'absolute',
            bottom: 46,
            right: 0,
            width: 244,
            background: 'rgba(17, 20, 26, 0.96)',
            border: '1px solid rgba(77, 157, 255, 0.35)',
            borderRadius: 12,
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.55)',
            backdropFilter: 'blur(8px)',
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            fontFamily: 'var(--font-barlow), sans-serif',
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 700, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Double-sided replay
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 12, color: '#a0a8b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Viewing <strong style={{ color: '#e6e6e6' }}>{viewLabel}</strong>
            </span>
            <button
              type="button"
              onClick={onFlip}
              title="Flip to the other player's recording"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, flex: '0 0 auto',
                background: 'rgba(77, 157, 255, 0.18)', border: '1px solid rgba(77, 157, 255, 0.5)',
                color: '#a7d2ff', fontSize: 11, fontWeight: 700, padding: '4px 10px',
                borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              ⇄ Flip
            </button>
          </div>
          <LedToggle
            checked={autoPov}
            onChange={onAutoPovChange}
            label="Auto-switch on turn change"
          />
          <div style={{ fontSize: 10.5, color: '#6c7588', lineHeight: 1.4 }}>
            Follows whoever is acting — the board fades to black and comes back
            from the other player&apos;s seat.
          </div>
        </div>
      )}
      <button
        type="button"
        data-testid="pov-bubble-fab"
        onClick={() => setOpen((v) => !v)}
        aria-label="Perspective controls"
        aria-expanded={open}
        title="Perspective (double-sided replay)"
        style={{
          width: 38,
          height: 38,
          background: open || autoPov ? 'rgba(77, 157, 255, 0.32)' : 'rgba(36, 48, 68, 0.85)',
          color: '#d6e7ff',
          border: '1px solid rgba(77, 157, 255, 0.4)',
          borderRadius: '50%',
          padding: 0,
          cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.45)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(6px)',
          transition: 'background 160ms ease',
          fontSize: 16,
          fontWeight: 700,
        }}
      >
        ⇄
      </button>
    </div>
  );
}
