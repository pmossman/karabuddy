import type { CSSProperties } from 'react';
import { tokens } from '@/app/_theme/karabuddyTokens';

// Shared primary-button look — the extension's dark-gradient + glowing-blue
// border ("My replays →"), matching the MUI `containedPrimary` theme so native
// <button>/<Link> primaries stay consistent with MUI ones. Spread into a style
// and override padding/width per use:  style={{ ...glowButtonStyle, padding: … }}
export const glowButtonStyle: CSSProperties = {
  display: 'inline-block',
  background: tokens.button.bg,
  color: tokens.color.accent,
  border: `1px solid ${tokens.color.primary}`,
  boxShadow: tokens.button.glow,
  borderRadius: tokens.radius.sm,
  padding: '9px 16px',
  fontSize: 13,
  fontWeight: 600,
  fontFamily: 'inherit',
  textDecoration: 'none',
  cursor: 'pointer',
};
