'use client';

import React from 'react';

// B136: the Clip FAB — a bottom-right bubble that opens the clip trim builder.
// Same 38px capsule styling as PovBubble / JumpToMenu so it stacks cleanly in
// the FAB cluster.
export function ClipBubble({
  onClick,
  bottom,
  right,
}: {
  onClick: () => void;
  bottom: string;
  right: string;
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
        bottom,
        right,
        zIndex: 90,
        width: 38,
        height: 38,
        borderRadius: 19,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid rgba(77, 157, 255, 0.4)',
        background: 'rgba(36, 48, 68, 0.85)',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.45)',
        backdropFilter: 'blur(6px)',
        color: '#d6e7ff',
        cursor: 'pointer',
        padding: 0,
      }}
    >
      {/* Film/clip glyph. */}
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 9h18M7 5v14M17 5v14" />
      </svg>
    </button>
  );
}
