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
- **Two intentional accents** (one electric family, adjacent hue): **primary
  `#4d9dff`** (azure) for actions/links/nav/logo — "do this"; **`#4dd2ff`**
  (cyan) for live/active signal — LED toggles, active states, recording — "this
  is on/live". The earlier muddy `#4a7cff`/`#5da9ff` were consolidated to these
  (B94, swept across app **and** extension so the two products share one
  palette). The logo "buddy" is a cyan→azure gradient tying both together.
- **Signature controls = bespoke LED, matching the extension.** The target
  aesthetic is the extension's "cockpit" LED toggle (glowing cyan ring + dot,
  left accent bar, monospace label, "SHARING" readout — `extension/replays/05-footer.js`).
  `app/_components/LedToggle.tsx` is a faithful React port, drawing from the
  `led` tokens, used for on/off + multi-select toggles (share-with-team, comment
  scope, settings) instead of MUI checkboxes/switches. It's `role="checkbox"`
  for a11y + tests. This is what makes the web and extension read as one product.
- **Everything else = themed MUI.** `app/_theme/karabuddyTheme.ts` builds a MUI
  theme from the tokens (palette + typography + Button/inputs) for the mundane
  controls. Applied by `<KaraBuddyThemeProvider>` wrapping the `(app)` layout —
  **no `CssBaseline`** (globals.css + the gameboard theme already own the
  body/background). The gameboard's own theme nests inside and wins for its
  subtree; conversely the chrome theme is **re-asserted over the viewer sidebar**
  (`ReplayViewer` wraps `TagSidebar` in `<KaraBuddyThemeProvider>`) because the
  sidebar otherwise sits under the gameboard theme.
- **Enforcement is a CI guard, not discipline.** `test/unit/no-native-form-controls.test.ts`
  greps `app/**/*.tsx` and fails on any native `type=checkbox|radio`. It runs in
  `test:unit` (part of the deploy gate) — same idiom as the migration guards.
  Chosen over wiring full ESLint because `next lint` over the lifted gameboard
  would be a rabbit hole; the guard gives the "can't introduce an unstyled
  checkbox" guarantee without it.
- **Extension** gets a parallel tiny plain-JS primitives module consuming the
  same tokens (synced like `commentScope.js`) in a later phase.

## Consequences

- A toggle = `<LedToggle>`; other controls = themed MUI. The guard enforces "no
  native checkbox/radio" regardless.
- This PR is the **foundation + proof-of-concept**: tokens (incl. the `led`
  palette), the MUI theme + provider, the `LedToggle` primitive, the guard, and
  the toggle offenders converted to LED (NotificationsForm, TeamNotificationPrefs,
  ShareWithTeam, ScopeChip team + personal). Remaining phases: migrate the
  chrome's hand-rolled **buttons** to themed MUI (with the extension's glow
  treatment) + inputs/selects; sync the `led` tokens into the extension so it
  consumes the shared source (rather than its current literals); a final
  spacing/type/motion polish.
- The guard currently covers **checkbox/radio only** — selects and text inputs
  are a larger migration, deliberately not yet guarded (noted so the scope
  isn't mistaken for complete).
- Sibling to the other "make the footgun structural" ADRs ([0002](./0002-gated-deploys.md),
  [0005](./0005-safe-deploys-expand-contract.md)).
