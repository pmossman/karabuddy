'use client';

import React from 'react';

// B136: the Clip FAB — opens the clip trim builder. On desktop it's a labeled
// "Clip" pill at the board's top-right; on mobile it collapses to a compact
// 38px round scissors bubble (conserving screen space) stacked under the ⓘ
// matchup button. (Existing clips are listed in the matchup info, not here.)
export function ClipBubble({
  onClick,
  top,
  right,
  left,
  compact = false,
}: {
  onClick: () => void;
  top: string;
  right?: string;
  left?: string;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid="clip-bubble"
      onClick={onClick}
      aria-label="Create a clip"
      title="Create a clip"
      style={{
        position: 'fixed',
        top,
        ...(left != null ? { left } : { right }),
        zIndex: 90,
        height: 38,
        ...(compact
          ? { width: 38, borderRadius: '50%', padding: 0, gap: 0 }
          : { borderRadius: 19, padding: '0 14px 0 12px', gap: 7 }),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid rgba(77, 157, 255, 0.4)',
        background: 'rgba(36, 48, 68, 0.85)',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.45)',
        backdropFilter: 'blur(6px)',
        color: '#d6e7ff',
        cursor: 'pointer',
        fontFamily: 'var(--font-barlow), -apple-system, sans-serif',
        fontSize: 13.5,
        fontWeight: 800,
        letterSpacing: '0.04em',
      }}
    >
      {/* Scissors — the universal "clip / cut" glyph. */}
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="6" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" />
      </svg>
      {!compact && <span>Clip</span>}
    </button>
  );
}
