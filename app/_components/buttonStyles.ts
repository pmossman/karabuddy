import type { CSSProperties } from 'react';

// Shared neutral/danger button looks for the small inline-styled buttons in team
// settings (rename / leave / transfer / delete). Spread into a style and override
// per use: style={{ ...btnDanger, opacity: … }}. Primary/accent buttons use
// `glowButtonStyle` (glowButton.ts) instead.
export const btnBase: CSSProperties = {
  border: 0,
  borderRadius: 6,
  padding: '8px 14px',
  fontSize: 12,
  fontWeight: 600,
  fontFamily: 'inherit',
  cursor: 'pointer',
};
export const btnGhost: CSSProperties = { ...btnBase, background: 'transparent', color: '#a0a8b8', border: '1px solid #4a4e56' };
export const btnDanger: CSSProperties = { ...btnBase, background: 'transparent', color: '#ff7a7a', border: '1px solid rgba(255, 122, 122, 0.4)' };
