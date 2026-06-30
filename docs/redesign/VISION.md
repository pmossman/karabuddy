# Replay Viewer Redesign — Vision (B216)

> Source of truth for *what we're building and why*. Paired with `PROGRESS.md`
> (the running log / state). Written 2026-06-30 from Parker's brief.

## The problem

The replay viewer (`/r/[slug]`) maintains **two divergent layouts**:

- **Desktop** — gameboard with a docked companion **drawer to the right** (tags,
  game log, review header, decks, resourcing). This feels fine.
- **Mobile** — the same information is crammed into a small **bottom sheet** with
  a tiny, cramped scrollable tag strip. You can't read more than one tag at a
  time. Plus scattered FABs (Clip, Jump-to, Playback, Info, ☰) clutter the board.

Two separate view-models = double maintenance and a bad mobile experience.

## The vision (Parker's words, distilled)

**One UI system that works on both sizes without separate view-modes.**

1. **Every viewer feature lives behind its own dedicated bubble/icon.** Mobile
   already does this for Clip / Jump-to / Playback — generalize it to *all*
   features (Tags, Game Log, Decks, Resourcing, Info/Matchup, Share…).
2. **Companion-to-gamestate features** (game log, tags) keep using the **space to
   the right of the board on desktop** (docked drawer). On **mobile**, with no
   side real estate, the *same feature* becomes a **full-screen / large overlay**
   so you can **read multiple tags at once** comfortably.
3. **Same component, screen-size-tailored presentation.** Not two
   implementations — one feature component, rendered by a shared layout primitive
   that picks "docked drawer" (desktop) vs "full-height sheet" (mobile).
4. Desktop and mobile should **look and behave consistently**, each tailored to
   its screen size.

## Where we start

A dedicated **Tag feature**, designed for both sizes:
- Its own icon bubble.
- A **readable multi-tag layout** (cards, not a cramped strip) — multiple tags
  visible at once on a 390px phone.
- Full-screen / large-sheet on mobile; docked drawer on desktop (parity or better
  than today's desktop).

Then **generalize the pattern** into a reusable feature-panel framework and
migrate the other features (Game Log next — proves it generalizes).

## MVP acceptance (what "done for the morning" means)

1. A shared **feature-panel primitive** + **bubble rail**, driven by ONE
   `openFeature` state (replacing the scattered `reviewOpen`/`matchupOpen`/… booleans).
2. **Tags feature** rebuilt on it — multiple tags readable at once at 390×844.
3. Desktop tags at **parity or better**.
4. No separate desktop/mobile view-model duplication for migrated features.
5. The existing viewer **still works** (exploratory branch — NOT shipped to prod).
6. **Self-verified with screenshots** at ≥ 390×844 (portrait), 844×390
   (landscape), ~768 (tablet), ~1440 (desktop).

## Constraints / guardrails

- **Do NOT ship to prod.** This lives on `redesign/replay-viewer` in a worktree.
- Keep the gameboard renderer untouched (lifted from karabast; just rehome the
  chrome/overlays around it).
- Reuse existing tag data + mutation logic (`/api/replays/[slug]/tags`,
  scope/mentions, review status) — this is a **UI/layout** redesign, not a data one.
- Build on existing primitives where sane: `Modal`, `ResponsiveMenu`, the design
  tokens (`app/_theme/karabuddyTokens.ts`). No native form controls.

## Key files (current viewer)

- `app/(app)/r/[slug]/ReplayViewer.tsx` — `ViewerShell` owns the dual layout:
  `reviewOpen` / `matchupOpen` / `resourcingOpen` / `clipOpen`, desktop docked
  `<aside>` vs mobile sheets, `useMediaQuery('(max-width: 900px)...')` = `isMobile`.
- `app/(app)/r/[slug]/TagSidebar.tsx` — the monolith: review-status header, tag
  form, tag list (This frame / Upcoming / Previous), replies, decks/resourcing launchers.
- `app/(app)/r/[slug]/MobileLandscapePanels.tsx` — mobile FAB + sheet system (the duplication).
- `FrameNavOverlay.tsx`, `JumpToMenu.tsx`, `ClipBubble.tsx`, `PovBubble.tsx` — board overlays/bubbles.
- `ReviewStatusHeader.tsx`, `FinishReviewModal.tsx` — review flow (lives in the tag panel).
- Overlay primitives to build on: `app/_components/Modal.tsx`, `ResponsiveMenu`.
