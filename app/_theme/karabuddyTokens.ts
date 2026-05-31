// KaraBuddy design tokens — the single source of truth for the "neon-dark"
// chrome aesthetic (everything outside the lifted forceteki gameboard, which
// keeps its own theme in ./theme.ts). These values were previously duplicated
// as inline-style literals across the replays / viewer / settings / teams UI;
// the design-system pass (B90) consolidates them here so the MUI theme
// (./karabuddyTheme.ts) and, eventually, the extension's plain-JS primitives
// all draw from one place. Add a token here before reaching for a raw hex.
export const tokens = {
  color: {
    // Surfaces (darkest → lightest).
    bgDeep: '#0a0c10', // card-image wells, deepest insets
    bg: '#11141a', // page / input background
    surface: 'rgba(17, 20, 26, 0.6)', // raised cards on the page
    surfaceSolid: 'rgba(17, 20, 26, 0.97)', // mobile drawers (opaque)

    // Borders / dividers (subtle → strong).
    border: '#2e333c',
    borderStrong: '#3a3e46',
    borderStronger: '#4a4e56',

    // Brand / interactive.
    primary: '#4a7cff', // primary action, active accents
    primaryHover: '#5d8bff',
    primarySoft: 'rgba(74, 124, 255, 0.18)', // active chip / hover fill
    accent: '#a0c4ff', // links, chip text on dark
    accentBright: '#5da9ff', // inline links

    // Text (brightest → faintest).
    text: '#e6e6e6',
    textSecondary: '#a0a8b8',
    textMuted: '#6c7588',
    textFaint: '#4a4e56',

    // Status.
    success: '#6bd968',
    successText: '#7fd97f',
    danger: '#ff6b6b',
    warn: '#e0c64a',
  },
  radius: {
    sm: 4,
    md: 6,
    lg: 10,
    pill: 999,
  },
  space: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
  },
  font: {
    family: 'var(--font-barlow), -apple-system, BlinkMacSystemFont, sans-serif',
  },
} as const;

export type Tokens = typeof tokens;
