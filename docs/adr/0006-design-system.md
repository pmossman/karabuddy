# 0006 — Design system: tokens + themed MUI, enforced

**Status:** Accepted (B90, 2026-05-31). Foundation live; migration ongoing.

## Context

The KaraBuddy chrome (replays, viewer sidebar, settings, teams) grew as
hand-rolled inline styles with the neon-dark palette duplicated as hex literals
everywhere, and a mix of **native** `<input type=checkbox/radio>` alongside
styled controls. MUI is in the stack but was only wired for the *lifted
forceteki gameboard* (`app/_theme/theme.ts`, applied via `ThemeContextProvider`
inside `ReplayViewer`) — the chrome had **no MUI ThemeProvider at all**, so MUI
primitives there would render unstyled. The goal: a cohesive aesthetic where
it's structurally impossible to ship an unstyled control.

A single shared *component* library can't span both targets: the **extension is
buildless plain JS** and can't import React/MUI. The thing that unifies them is
shared **design tokens**.

## Decision

- **Tokens** (`app/_theme/karabuddyTokens.ts`) are the single source for the
  neon-dark palette / radii / spacing / font. Reach for a token before a raw hex.
- **Web = themed MUI.** `app/_theme/karabuddyTheme.ts` builds a MUI theme from
  the tokens (palette + typography + component styling for Checkbox, Radio,
  Switch, Button, inputs). It's applied by `<KaraBuddyThemeProvider>` wrapping
  the `(app)` layout — **no `CssBaseline`** (globals.css + the gameboard theme
  already own the body/background; a second baseline would fight both). The
  gameboard's own theme nests inside and wins for its subtree.
- **Enforcement is a CI guard, not discipline.** `test/unit/no-native-form-controls.test.ts`
  greps `app/**/*.tsx` and fails on any native `type=checkbox|radio`. It runs in
  `test:unit` (part of the deploy gate) — same idiom as the migration guards.
  Chosen over wiring full ESLint because `next lint` over the lifted gameboard
  would be a rabbit hole; the guard gives the "can't introduce an unstyled
  checkbox" guarantee without it.
- **Extension** gets a parallel tiny plain-JS primitives module consuming the
  same tokens (synced like `commentScope.js`) in a later phase.

## Consequences

- Converting a control = use `@mui/material`'s `<Checkbox>/<Radio>/<Switch>`
  (+ `<FormControlLabel>`); the guard enforces it for checkbox/radio.
- This PR is the **foundation + proof-of-concept**: tokens, theme, provider,
  the guard, and the five native offenders converted (NotificationsForm,
  TeamNotificationPrefs, ShareWithTeam, ScopeChip ×2). Remaining phases:
  migrate the rest of the chrome's hand-rolled controls (buttons, inputs,
  selects) to themed MUI; widen the guard to selects/inputs; build the
  extension primitives module; a final spacing/type/motion polish.
- The guard currently covers **checkbox/radio only** — selects and text inputs
  are a larger migration, deliberately not yet guarded (noted so the scope
  isn't mistaken for complete).
- Sibling to the other "make the footgun structural" ADRs ([0002](./0002-gated-deploys.md),
  [0005](./0005-safe-deploys-expand-contract.md)).
