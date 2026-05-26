# karabuddy backlog

Source of truth for outstanding work. The autonomous loop pulls from **Backlog** (top-down = highest priority), moves the claimed entry into **In Progress** while working, and appends it to **Done** when complete.

## Conventions

- Every task has a stable ID like `B1`, `B2`, etc. IDs are append-only — never reuse one even after deletion.
- The next new task uses the highest existing ID + 1 across all sections (Backlog + In Progress + Done).
- A task is **claimed** by moving its block under `## In Progress` and adding a `_claimed: YYYY-MM-DD HH:MM by <agent>_` line at the top of the block. Only one task should sit in In Progress per agent at a time.
- A task is **finished** by moving its block to the top of `## Done` and adding a `_completed: YYYY-MM-DD by <agent>_` line. Include a one-line summary of what shipped.
- Tasks should always have **Acceptance** so "done" is unambiguous.
- Screenshots / references / prior conversation links go under **Refs**.

## Backlog

### [B15] Extension publication prep + install instructions on the homepage

- **Why:** The chrome extension is mature enough to share more broadly, but there's no obvious install path for new users and no submission-ready packaging. Need both the extension polished for the Chrome Web Store submission flow AND a clear "Install" walkthrough surfaced on karabuddy's homepage.
- **Acceptance:**
  - **Extension prep:**
    - `extension/manifest.json` cleaned up for submission: descriptive `name` and `description`, sensible `version` (start at 0.3.0 to mark "ready-for-store"), bumped `version_name` if used.
    - Add icon assets if missing (`icons/16.png`, `48.png`, `128.png` referenced from `manifest.json` → `action.default_icon` and top-level `icons`). If existing assets are missing, generate placeholders from the KARA/buddy logo or leave a TODO note specifying the exact files to produce.
    - Add `extension/README.md` with: what the extension does, current features (replay record/play/tag, solo testing, sidebar overlay on karabast.net), build/load instructions (load-unpacked vs zip), known limitations.
    - Add a `scripts/package-extension.sh` (or npm script) that zips `extension/` into a release-ready bundle — strip dev-only files, ensure manifest.json is at zip root.
  - **Install instructions on the site:**
    - New `/install` route (or section on the homepage) with a step-by-step walkthrough for Chrome (the only supported browser at launch). Cover: download the zip, unzip, `chrome://extensions`, enable Developer Mode, Load unpacked, point at the unzipped folder. Once we have a Chrome Web Store listing, swap the steps for "Install from the Store" with the marketplace link.
    - Header tile or footer link on the homepage pointing at `/install`.
    - Mention Firefox / Edge as "coming later" with a brief note that we'd port the MV3 manifest with minor tweaks. Don't write install steps for them yet.
  - **Punt explicitly if blocked:**
    - Chrome Web Store submission itself (requires the user's $5 developer account + screenshots + privacy policy text) — out of scope. The task here is "submission-ready", not "submitted".
- **Refs:** Extension lives at `~/code/karabuddy/extension/` (post-B9). Homepage: `app/(app)/page.tsx`. Existing `Tile` component is a good pattern for the homepage "Install" entry point.

### [B14] Move tag controls down beside the tag display area

- **Why:** Current sidebar order is matchup → navigation → tag controls (+ Tag this frame / prev tag / next tag) → game log → tag display. Tag controls being between navigation and game log makes them feel disconnected from the tag list they actually act on. Should sit immediately adjacent to the tag display so the affordance reads naturally.
- **Acceptance:** Sidebar order top-to-bottom: matchup → navigation → game log → tag controls (the row B12 built: + Tag this frame, ‹ Prev tag, Next tag › ) → tag display (THIS FRAME callout + All tags list). The inline-comment form that opens when "+ Tag this frame" is clicked still appears directly under the button. No behavior change — purely a section-reorder.
- **Refs:** `app/(app)/r/[slug]/TagSidebar.tsx`. The tag controls + form live in the section currently rendered before FrameLog; FrameLog + tag display are in the section after. Reorder the JSX so the tag-controls section + the form render between FrameLog and the tag display sections.

### [B13] Wire `[` / `]` keyboard shortcuts for prev/next tag in the viewer

- **Why:** Viewer tooltips reference `[` / `]` keyboard shortcuts for tag navigation, but the `ReplayViewer.tsx` keydown handler doesn't actually wire them — only ArrowLeft/Right/Home/End are handled. Surfaced as a B12 punt.
- **Acceptance:** Pressing `[` jumps to the prev tag (same target as the Prev tag button); `]` jumps to next. No-ops when no tag exists in that direction. Ignored when a TEXTAREA / INPUT is focused, matching the existing arrow-key handler's guard.
- **Refs:** `app/(app)/r/[slug]/ReplayViewer.tsx` keydown handler. The `jumpToAdjacent(dir)` helper currently lives inside `TagSidebar.tsx` — pull it up into `ReplayViewer.tsx` (or pass a callback prop) so the keydown handler can call it without DOM querying.

## In Progress

_empty_

## Done

### [B12] Sidebar polish: tag nav near tags, usernames under thumbs, drag-to-resize width
_completed: 2026-05-26 by autonomous-loop_
Prev/Next tag buttons share a row with "+ Tag this frame" (right-aligned). MatchupRow refactored: thumbs in a row, username on its own centered line below per player. 6px right-edge drag handle with hover/active accent-blue treatment, double-click resets to 360px default, width clamped 280px ↔ 50vw, persisted to `localStorage['karabuddy:viewerSidebarWidth']`. Flagged: `[` / `]` keyboard shortcuts not wired in `ReplayViewer.tsx` — tracked as B13.

### [B11] Game log highlight follows transition, not just current frame
_completed: 2026-05-26 by autonomous-loop_
Added `lastTransition: { from: number; to: number } | null` state in `ReplayViewer.tsx`, recorded on every `setCurrentIndex` call. Plumbed into `TagSidebar.tsx`'s FrameLog: forward steps (lo → hi where hi > lo) highlight messages on frames `lo+1..hi`; backward steps or initial load highlight only the current frame. Header copy switches to "What happened (over N frames)" when the range spans multiple frames. Transition gated on `lt.to === currentIndex` so stale transitions don't leak after intervening state changes.

### [B10] Compact the viewer sidebar — give the log + tags more vertical room
_completed: 2026-05-26 by autonomous-loop_
Inline single-row matchup (32×32 thumbs + usernames). Share controls collapsed behind a top-right Share icon button + popover. Step-mode toggle (Action/Frame + Shift hint) tucked into a gear popover next to the frame counter. Navigation tightened to a single `← [Frame N/M] → [gear]` row. New reusable `app/_components/Popover.tsx`. Net ~170–180px reclaimed above the fold.

### [B9] Monorepo: chrome extension brought into karabuddy
_completed: 2026-05-26 by autonomous-loop_
`git subtree add --squash` from `~/code/karabast-extension` + working-tree overlay (the source repo had 18 uncommitted modifications) → `extension/` subdir at repo root (22 files). `.vercelignore` added (excludes `extension/` from deploy bundle). `tsconfig.json` excludes `extension/` defensively. `CLAUDE.md` updated with load-unpacked + zip-packaging workflow. `~/code/karabast-extension/` left untouched for the user to archive.

### [B1] Game board bottom is clipped under the persistent header
_completed: 2026-05-26 by subagent_
Subtracted `var(--kb-header-h)` from the Gameboard root `height` in `app/_components/Gameboard/Gameboard.tsx` and switched the inner row heights from `dvh` to percentages so the tray rows sum against the constrained container.

### [B2] Restore the per-frame "what happened" log in the sidebar
_completed: 2026-05-26 by subagent_
Plumbed `messagesByFrame` from ReplayViewer → TagSidebar; added a new FrameLog section between the tag-form and All-tags sections. Current-frame messages at full opacity, prior frames dimmed to ~0.45. Ported the extension's player color-coding (frame-0 players 0/1 → blue/red).

### [B3] When at a tag's frame, don't duplicate it in the All Tags list
_completed: 2026-05-26 by subagent_
"All tags" list now filters out tags whose `frameIndex === currentIndex`; the THIS FRAME callout stays as the sole renderer for those. Empty-state copy when only current-frame tags exist.

### [B4] Opponent hand card backs render as solid black
_completed: 2026-05-26 by subagent_
Root cause: `stripHiddenHandCards` assigned hidden hand stubs `setId.set = 'REPLAYHIDDEN'`, which made `s3CardImageURL` build a 404 URL instead of taking the no-setId cardback fallback. Added an early-return in `app/_utils/s3Utils.ts` so any card with the `HIDDEN_SET` sentinel renders as the cardback art.

### [B5] Strip non-functional interactive UI from the replay viewer
_completed: 2026-05-26 by subagent_
Removed the X (close), gear (settings), and chat-expand controls + their handlers/props from `OpponentCardTray`, `PlayerCardTray`, `GameboardTypes`, and `Gameboard.tsx`. Sidebar slot is hardcoded open so the right-padding stays for the viewer's tag sidebar.

### [B6] Share affordance in the viewer (copy link + public toggle)
_completed: 2026-05-26 by subagent_
New Share section above Navigation. "Copy link" for everyone with `navigator.clipboard` + `execCommand` fallback (label flips to "Copied!" for ~2s). Owner-only visibility pill with optimistic toggle (revert on server failure). Owner check mirrors the server's `canMutate` (session userId OR install token).

### [B7] Refine tag ownership: replay owner can delete, only author can edit
_completed: 2026-05-26 by subagent_
Server: split `canMutate` → `canEdit` (tag author only, PATCH) + `canDelete` (tag author OR replay owner, DELETE). Client TagSidebar computes `canEdit` / `canDelete` per tag from the session + install token + replay ownership. Replay owners see Delete on others' tags but no Edit; tag authors keep both.

### [B8] Hint keyboard navigation on the prev/next frame arrow buttons
_completed: 2026-05-26 by subagent_
`title=` tooltips on ← / → buttons ("Previous frame (←)" / "Next frame (→)"). One-line italic hint "Or use arrow keys to step." under the prev/next tag buttons. Existing Shift-modifier hint untouched.
