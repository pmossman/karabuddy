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
        label: { fontSize: 13, color: tokens.color.text },
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
        containedPrimary: {
          backgroundColor: tokens.color.primary,
          '&:hover': { backgroundColor: tokens.color.primaryHover },
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
