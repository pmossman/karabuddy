'use client';

import React from 'react';

// B128: the double-sided replay control — a compact split capsule (rendered
// only when both teammates' recordings exist), stacked in the bottom-right
// FAB cluster above Jump-to-moment:
//   • left half: "both hands face up" toggle (lit when on) — merges the other
//     recording's unmasked hand + resources into the board.
//   • right half: manual Flip — snappy dip-to-black, sit in the other seat.

export function PovBubble({
  viewLabel,
  onFlip,
  revealHands,
  onRevealHandsChange,
  bottom,
  right,
}: {
  viewLabel: string;
  onFlip: () => void;
  revealHands: boolean;
  onRevealHandsChange: (next: boolean) => void;
  bottom: string;
  right: string;
}) {
  const half: React.CSSProperties = {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    background: 'transparent',
    border: 0,
    padding: '0 12px',
    cursor: 'pointer',
    color: '#d6e7ff',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  };

  return (
    <div
      data-testid="pov-controls"
      style={{
        position: 'fixed',
        bottom,
        right,
        zIndex: 90,
        display: 'flex',
        alignItems: 'stretch',
        height: 38,
        borderRadius: 19,
        overflow: 'hidden',
        border: '1px solid rgba(77, 157, 255, 0.4)',
        background: 'rgba(36, 48, 68, 0.85)',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.45)',
        backdropFilter: 'blur(6px)',
      }}
    >
      <button
        type="button"
        data-testid="reveal-toggle"
        onClick={() => onRevealHandsChange(!revealHands)}
        aria-pressed={revealHands}
        aria-label="Both hands face up"
        title={revealHands ? 'Both hands face up — on (showing the opponent’s hand + resources from your teammate’s recording)' : 'Both hands face up — off'}
        style={{
          ...half,
          background: revealHands ? 'rgba(77, 157, 255, 0.32)' : 'transparent',
          transition: 'background 160ms ease',
        }}
      >
        <RevealIcon on={revealHands} />
        Hands up
      </button>
      <span aria-hidden style={{ width: 1, background: 'rgba(77, 157, 255, 0.3)' }} />
      <button
        type="button"
        data-testid="flip-button"
        onClick={onFlip}
        aria-label={`Flip perspective — viewing ${viewLabel}`}
        title={`Flip perspective — viewing ${viewLabel}`}
        style={half}
      >
        <span aria-hidden style={{ fontSize: 16, lineHeight: 1 }}>⇄</span>
        Flip
      </button>
    </div>
  );
}

// Two fanned cards, face-up when on (filled face) vs face-down when off.
function RevealIcon({ on }: { on: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3.5" y="5" width="10" height="14" rx="1.5" transform="rotate(-8 8.5 12)" />
      <rect x="10.5" y="5" width="10" height="14" rx="1.5" transform="rotate(8 15.5 12)" fill={on ? 'rgba(77, 210, 255, 0.35)' : 'none'} />
      {on && <circle cx="15.5" cy="12" r="1.6" fill="currentColor" stroke="none" />}
    </svg>
  );
}
