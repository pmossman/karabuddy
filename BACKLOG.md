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

### [B20] Extension: collapse to floating-button-only + cut in-place playback + cut popup

- **Why:** Now that karabuddy.app owns replay browsing, playback, sharing, account, and settings, the extension's only unique value is what it can do *on karabast.net* (capture WebSocket frames, inject UI, tag mid-game) plus the karabuddy.app bridge for install-token claim and solo testing. The current slide-in sidebar is overkill for the one mid-game affordance we actually need, and the in-place playback code (`04-playback.js`, ~713 lines) duplicates karabuddy.app's `/r/[slug]` viewer with a fragile dependency on karabast.net's socket.io protocol. The toolbar popup is a glorified bookmark. Lock the extension down to its minimum surface.
- **Acceptance:**
  - **Sidebar deleted, replaced by an expanding floating panel anchored to the launcher button.**
    - When no match is active (recorder hasn't seen a gamestate): launcher button is **hidden entirely**. Zero karabuddy footprint on karabast.net until capture begins.
    - When match is active: launcher shows the existing REC indicator + event count, collapsed.
    - Click the launcher → expands to a small floating panel anchored to the launcher's current bounding rect, with smart edge-detection so it doesn't overflow the viewport (open leftward if the launcher is near the right edge; upward if near the bottom).
    - Expanded panel contents (top to bottom): compact REC + event count header, prominent `+ Tag this moment` button that toggles an inline textarea + Save/Cancel, recent tags list (last 5, compact), and a `Open this replay on karabuddy →` link that's hidden until `R().getCurrentKarabuddyUrl()` returns a string.
    - Collapse triggers: click outside the panel, OR an explicit `×` button in the panel's top-right corner. Pressing the launcher button while expanded does NOT collapse (avoids confusing toggle-on-self semantics since the button is inside the panel anchor).
    - Drag (B16) still works on the collapsed launcher; while expanded the panel follows the launcher's position. If the user drags the launcher while expanded, collapse first.
    - The idle-state link buttons (`Open my replays →`, `Link this extension →`) are **gone** — `Open my replays` is just a bookmark, and `Link this extension` is redundant with karabuddy.app/claim's `AutoDetectExtension` flow (uses the same bridge protocol). Discoverability lives on karabuddy.app, not karabast.net.
    - The footer's contextual exit button goes away (no sidebar to exit).
  - **In-place replay playback cut entirely:**
    - Delete `extension/replays/04-playback.js`.
    - Remove it from `manifest.json`'s MAIN-world `content_scripts.js` list.
    - Remove `REPLAY_FLAG` / `installFrame` / `extReplay`-URL handling from `extension/replays/06-bootstrap.js`.
    - Remove any `P()` references / playback-state DOM in `05-footer.js`.
    - Remove the `Tag saved` toast trigger that B18 wired into `P().addTag()` (it goes with the playback delete).
    - Any background.js code that exists solely to support in-place playback can go too.
  - **Popup cut, replaced with single-click toolbar action:**
    - Delete `extension/popup.html`, `popup.js`, `popup.css`.
    - Remove `action.default_popup` from `manifest.json` (keep `default_title` + `default_icon`).
    - Add a `chrome.action.onClicked` listener in `background.js` that opens `<karabuddyEndpoint>/replays?tab=mine` in a new tab (re-use the tab-reuse logic from `openReplaysPage`).
    - Remove the `getKarabuddyEndpoint` message handler from `background.js` (it was added in B19 solely for the popup; background can call `getKarabuddyEndpoint()` directly now).
  - **Implement `R().getCurrentKarabuddyUrl()`:**
    - In `extension/replays/03-recorder.js`, cache `result.url` on the recorder's state after a successful `B().uploadReplay(...)` call. Expose via a `R().getCurrentKarabuddyUrl()` method that returns the cached URL or null.
    - The expanded panel's `Open this replay on karabuddy →` link unhides once this returns a string.
    - Clear the cached URL when a new match starts (first gamestate of a new recording).
- **What to preserve:**
  - `extension/replays/02-decoder.js` — WebSocket decoder.
  - `extension/replays/03-recorder.js` — recording + upload logic (just add the URL cache + getter).
  - `extension/karabuddy-bridge.js` — install-token bridge on karabuddy.app.
  - Solo testing: `solo-main.js`, `content.js`, `options.html`/`js`/`css`, DNR rules in `background.js`.
  - `extension/replays/07-toast.js` — toasts still anchor to the launcher's current position; verify they still work after the launcher gains expand/collapse states.
  - B18 toast triggers in `03-recorder.js`: `Recording…`, `Tag saved` (recording state only after the playback cut), `Replay uploaded`, `Upload failed`, `Replay saved`.
  - B16 drag + persistence to `chrome.storage.local.karabuddyLauncherPos`.
- **Refs:** `extension/replays/05-footer.js` (heavy rewrite — most of this file's idle/playback DOM goes; rebuild as a floating expandable panel). `extension/replays/06-bootstrap.js` (drop REPLAY_FLAG branching). `extension/background.js` (chrome.action.onClicked addition + getKarabuddyEndpoint handler removal + cleanup of any playback-only handlers). `extension/manifest.json` (drop popup, drop 04-playback.js). After this lands the extension is ~2400-2600 lines, down from ~4650.

## Continuation prompt

## Continuation prompt

A new chat can be bootstrapped with the prompt at `scripts/continuation-extension-rework.md`. Hand the user that file's contents and they're ready to `/clear` and start fresh.

## In Progress

_empty_

## Done

### [B17] Extension: strip the sidebar down to recording-only
_completed: 2026-05-26 by autonomous-loop_
Idle state collapses to KARA/buddy + auto-recording hint + two link buttons (`Open my replays →` to `<endpoint>/replays?tab=mine`, `Link this extension →` to `<endpoint>/claim?token=...`). Recording state becomes the primary panel: REC indicator + event count, stretched `+ Tag this moment` button, tags list, hidden `Open this replay on karabuddy →` link that waits on a future `R().getCurrentKarabuddyUrl()` getter. Playback sidebar surface (frame stepper, prev/next tag, log, tag callout) deleted — karabuddy.com is the viewer now; `extReplay` flow + fake socket.io transport in `04-playback.js` retained for the in-place player bounce. Solo state untouched. Deleted `extension/replays.html|css|js`; `openReplaysPage` in `background.js` redirects to `<endpoint>/replays?tab=mine` (reuses existing matching tab when found).

### [B18] Extension: toast notifications popping from the launcher
_completed: 2026-05-26 by autonomous-loop_
New `extension/replays/07-toast.js` MAIN-world module registered in `manifest.json` before `06-bootstrap.js`; exposes `NS.toast.show(text, opts?)`. Pill anchors live to the draggable launcher's bounding rect, stacks newest-on-top with column-reverse, slide+fade ~150ms in/out around a 3000ms hold, suppressed when the sidebar is open. Triggers wired: `Recording…` on first gamestate, `Tag saved` on `R().addTag()` and `P().addTag()`, `Replay saved` on non-manual IDB save, `Replay uploaded` (with URL tooltip) / `Upload failed` around the upload promise in `03-recorder.js`.

### [B19] Extension: replace the action popup with a karabuddy redirect
_completed: 2026-05-26 by autonomous-loop_
`popup.html` rewritten to a ~300px panel with KARA/buddy mark + three buttons (`My replays`, `Browse public`, `Solo testing`). `popup.js` dropped the deck-library/config code in favor of three `chrome.tabs.create` handlers — replay buttons resolve `<karabuddyEndpoint>/replays?tab=mine|public` via a new `getKarabuddyEndpoint` message handler added to `background.js`; Solo testing still opens `options.html`. `popup.css` slimmed to the new dark/Barlow layout; `options.html` left intact for solo.

### [B16] Make the extension launcher button click+draggable
_completed: 2026-05-26 by autonomous-loop_
mousedown on the launcher captures start coords + bounding rect; window-level mousemove/mouseup so drag survives leaving the button. 4px Euclidean threshold flips click→drag (so short drags still open the sidebar). Cursor `grab` idle / `grabbing` mid-drag; `touch-action: none`. Position clamped to viewport, persisted to `chrome.storage.local.karabuddyLauncherPos`; restored on load. Synthetic click suppressed since open-path moved to mouseup. Punted: touch/pointer events, window-resize re-clamp.

### [B15] Extension publication prep + install instructions on the homepage
_completed: 2026-05-26 by autonomous-loop_
Extension: bumped to 0.3.0 with richer description + 16/48/128 icons (programmatically generated placeholders — `extension/icons/{16,48,128}.png`), `extension/README.md` covering features + load-unpacked + packaging, `scripts/package-extension.sh` (zips to `dist/karabuddy-extension-<version>.zip` with manifest at zip root) wired as `npm run package:extension`, `dist/` in .gitignore. Site: new `/install` route with 7-step Chrome walkthrough + Firefox/Edge "coming later" note; homepage "Chrome extension" tile repurposed to point at `/install`. **User TODOs:** replace placeholder icons with polished artwork; publish a GitHub release with the zip so the /install step-1 link works; Chrome Web Store submission itself (dev account + screenshots + privacy policy) intentionally punted.

### [B14] Move tag controls down beside the tag display area
_completed: 2026-05-26 by autonomous-loop_
JSX shuffle in TagSidebar.tsx — new section order: matchup → navigation → FrameLog → tag controls + form → tag display. Inline-comment form still appears under "+ Tag this frame" when opened. No behavior change.

### [B13] Wire `[` / `]` keyboard shortcuts for prev/next tag
_completed: 2026-05-26 by autonomous-loop_
Lifted `jumpToAdjacent(dir)` out of TagSidebar.tsx → into ReplayViewer.tsx (approach A). Wired `[` / `]` into the keydown handler with the same TEXTAREA/INPUT focus guard the arrow keys use. TagSidebar's prev/next buttons now call the handler via a new `onJumpToAdjacentTag` prop.

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
