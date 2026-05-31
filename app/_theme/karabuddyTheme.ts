import { createTheme } from '@mui/material/styles';
import { tokens } from './karabuddyTokens';

// MUI theme for the KaraBuddy chrome (replays / viewer sidebar / settings /
// teams) — built from ./karabuddyTokens so MUI primitives match the neon-dark
// hand-rolled aesthetic. Distinct from ./theme.ts, which themes the lifted
// forceteki gameboard and stays scoped to it (it nests inside this one in the
// viewer and wins for its own subtree).
//
// Applied via <KaraBuddyThemeProvider> around the (app) layout. Deliberately
// NO CssBaseline here — globals.css already owns the body/background/scrollbar
// base, and the gameboard theme injects its own; a second baseline would fight
// both. So this theme only supplies palette + typography + component styling
// to MUI components rendered in the chrome.
export const karabuddyTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: tokens.color.primary },
    background: { default: tokens.color.bg, paper: tokens.color.bg },
    divider: tokens.color.border,
    text: { primary: tokens.color.text, secondary: tokens.color.textSecondary },
    success: { main: tokens.color.success },
    error: { main: tokens.color.danger },
    warning: { main: tokens.color.warn },
  },
  shape: { borderRadius: tokens.radius.md },
  typography: {
    fontFamily: tokens.font.family,
  },
  components: {
    MuiCheckbox: {
      defaultProps: { size: 'small', disableRipple: true },
      styleOverrides: {
        root: {
          color: tokens.color.textMuted,
          padding: 4,
          // Pin the icon in px: the lifted gameboard's CssBaseline sets a
          // responsive html font-size (17–18px wide), and MUI icons are
          // rem-based — without this they balloon in the viewer sidebar.
          '& .MuiSvgIcon-root': { fontSize: 17 },
          '&.Mui-checked': { color: tokens.color.primary },
          '&.Mui-disabled': { color: tokens.color.textFaint },
        },
      },
    },
    MuiRadio: {
      defaultProps: { size: 'small', disableRipple: true },
      styleOverrides: {
        root: {
          color: tokens.color.textMuted,
          padding: 4,
          '& .MuiSvgIcon-root': { fontSize: 17 },
          '&.Mui-checked': { color: tokens.color.primary },
        },
      },
    },
    MuiSwitch: {
      defaultProps: { size: 'small' },
      styleOverrides: {
        switchBase: {
          color: tokens.color.textSecondary,
          '&.Mui-checked': { color: tokens.color.primary },
          '&.Mui-checked + .MuiSwitch-track': {
            backgroundColor: tokens.color.primary,
            opacity: 0.5,
          },
        },
        track: { backgroundColor: tokens.color.borderStronger, opacity: 1 },
      },
    },
    MuiFormControlLabel: {
      styleOverrides: {
        root: { marginLeft: -4, gap: 6 },
        // Compound selector (`&.MuiTypography-root`) raises specificity above
        // the Typography body1 variant so the px size wins over the gameboard's
        // rem inflation; otherwise the label renders at the inflated 1rem.
        label: { '&.MuiTypography-root': { fontSize: 13, lineHeight: 1.3, color: tokens.color.text } },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          borderRadius: tokens.radius.sm,
        },
        // Primary = the extension's "My replays →" look: dark gradient body,
        // glowing blue border, light-blue label.
        containedPrimary: {
          background: tokens.button.bg,
          color: tokens.color.accent,
          border: `1px solid ${tokens.color.primary}`,
          boxShadow: tokens.button.glow,
          '&:hover': {
            background: tokens.button.bgHover,
            borderColor: tokens.color.primaryHover,
            boxShadow: tokens.button.glowHover,
          },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: tokens.color.bg,
          '& .MuiOutlinedInput-notchedOutline': { borderColor: tokens.color.border },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: tokens.color.borderStrong },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: tokens.color.primary },
        },
        input: { color: tokens.color.text },
      },
    },
  },
});
