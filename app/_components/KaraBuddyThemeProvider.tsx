'use client';

import { ThemeProvider } from '@mui/material/styles';
import { karabuddyTheme } from '@/app/_theme/karabuddyTheme';

// Wraps the (app) chrome so MUI primitives (Checkbox, Switch, Radio, Button,
// TextField …) render in the KaraBuddy neon-dark theme. No CssBaseline — see
// the note in karabuddyTheme.ts. The gameboard's own ThemeContextProvider
// nests inside this (in ReplayViewer) and overrides for the gameboard subtree.
export function KaraBuddyThemeProvider({ children }: { children: React.ReactNode }) {
  return <ThemeProvider theme={karabuddyTheme}>{children}</ThemeProvider>;
}
