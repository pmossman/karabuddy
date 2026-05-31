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
  // LED toggle aesthetic — mirrors the extension's "cockpit" share controls
  // (extension/replays/05-footer.js buildShareRow). A glowing cyan ring + dot
  // signals "live". Kept byte-aligned with the extension so the two UIs read
  // as one product; when the extension consumes shared tokens (later phase)
  // these become the single source.
  led: {
    on: '#4dd2ff', // active ring/dot/status — cyan "live signal"
    off: '#3a4150', // inert ring + accent bar
    textOn: '#d6f0ff',
    textOff: '#a8b0bd',
    ringGlow: '0 0 6px rgba(77, 210, 255, 0.7), inset 0 0 4px rgba(77, 210, 255, 0.45)',
    ringInert: 'inset 0 0 2px rgba(0,0,0,0.6)',
    dotGlow: '0 0 4px #4dd2ff',
    rowOn: 'rgba(77, 210, 255, 0.08)',
    rowHover: 'rgba(77, 210, 255, 0.04)',
    rowOff: 'rgba(255, 255, 255, 0.02)',
    mono: '"SF Mono", Menlo, Consolas, monospace',
  },
  // "Tactical dark" surfaces + glows (B93 reskin) — raised panels get a faint
  // top-lit gradient + depth shadow; the primary button is the extension's
  // dark-gradient + glowing-blue-border look ("My replays →").
  surface: {
    panel: 'linear-gradient(155deg, rgba(42, 54, 74, 0.32) 0%, rgba(17, 20, 26, 0.55) 68%)',
    panelShadow: '0 2px 14px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.03)',
    panelBorder: '#2b323d',
  },
  button: {
    bg: 'linear-gradient(150deg, #243044 0%, #1a1d23 100%)',
    bgHover: 'linear-gradient(150deg, #2a3850 0%, #1e222a 100%)',
    glow: '0 0 10px rgba(74, 124, 255, 0.22), inset 0 0 8px rgba(74, 124, 255, 0.08)',
    glowHover: '0 0 15px rgba(74, 124, 255, 0.45), inset 0 0 10px rgba(74, 124, 255, 0.14)',
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
