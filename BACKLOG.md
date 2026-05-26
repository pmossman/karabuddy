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

### [B17] Extension: strip the sidebar down to recording-only

- **Why:** The karabuddy webapp now handles replay browsing, playback, tag display, sharing, account, and settings. The extension's sidebar still has full idle/playback sections for all of that — duplicate surface that's drifted out of date. The extension's true job going forward is narrow: record matches in the background, and offer a focused mid-game tagging UI when the user opens the sidebar during a game.
- **Acceptance:**
  - **Sidebar idle state** (no game running): replace the current Replays / Saved replays / Solo testing / Account sections with a tiny landing: KARA/buddy header, one-line "Recording is automatic during karabast matches" hint, and **two link buttons** — `Open my replays →` (→ `<karabuddyEndpoint>/replays?tab=mine` via `chrome.tabs.create`) and `Link this extension →` (→ `<karabuddyEndpoint>/claim?token=<installToken>`, same flow as B16's openKarabuddyClaim). That's it for idle.
  - **Sidebar playback state**: remove entirely. The extension no longer drives playback — karabuddy.com is the viewer. The `extReplay` URL-flag flow in `04-playback.js` + the fake socket.io transport can stay (they're still used when karabuddy bounces a replay into karabast.net for the in-place player), but the sidebar's playback chrome (frame stepper, prev/next tag, tag list, log) all goes.
  - **Sidebar recording state**: this is the new primary panel. Big visible REC indicator + event count (already exists). Underneath: a prominent `+ Tag this moment` button that opens an inline comment textarea + Save / Cancel. Below: the recent tags list (same data, smaller). Optionally an "Open this replay on karabuddy →" link once we've uploaded mid-game (extension already auto-uploads on finalize; until then the link is hidden).
  - **Sidebar solo state**: leave alone for now. Solo is still extension-only and is its own task to move to karabuddy later. Just don't break it.
  - **Files to delete or trim heavily:** `extension/replays.html`, `extension/replays.css`, `extension/replays.js` — all chrome-extension://-hosted UI replaced by karabuddy. Anywhere in `extension/background.js` that opens `chrome.runtime.getURL('replays.html')` (e.g. `openReplaysPage`) needs to redirect to `<karabuddyEndpoint>/replays?tab=mine` instead.
  - **Footer** of the sidebar: the contextual exit button stays.
- **Refs:** `extension/replays/05-footer.js` is where most of the sidebar lives. `extension/background.js` has the `openReplaysPage` handler. `extension/manifest.json`'s `web_accessible_resources` (if it lists replays.html) needs cleanup. Keep the karabuddy upload + extension-token claim flows (B6/B9/B16 era) intact.

### [B18] Extension: toast notifications popping from the launcher

- **Why:** When events happen in the background (replay saved, tag added, upload succeeded, upload failed) the user has no feedback unless they open the sidebar. A small toast that pops out of the launcher button — even when the sidebar is closed — turns the launcher into a passive status surface.
- **Acceptance:**
  - New `extension/replays/07-toast.js` module (or similar) loaded by the manifest's MAIN-world content_scripts list. Exposes `NS.toast.show(text, opts?)` and is called from the recorder/playback/footer wherever a status change happens.
  - Visual: a small pill (~200–260px wide) that emerges from the right edge of the launcher button (extends rightward, vertically centered against the launcher) with a colored leading dot (success green, info blue, error red). The launcher stays in place; the pill animates in with a brief slide+fade (~150ms), holds for ~3000ms (configurable per-call), then fades out.
  - When multiple toasts fire in close succession, they stack vertically (new on top, older pushed down) or queue (whichever is cleaner to implement — your call).
  - Triggers wired into existing code paths:
    - Recording started (first gamestate received) → `Recording…` (info)
    - Tag added (recording OR playback state) → `Tag saved` (success)
    - Upload to karabuddy succeeded → `Replay uploaded` (success) with the URL as a hover tooltip
    - Upload to karabuddy failed → `Upload failed` (error)
    - Replay finalized + saved to IDB → `Replay saved` (success)
  - Toasts respect the launcher's current position (it's draggable per B16) — the pill anchors to the launcher's current bounding rect, not a fixed corner.
  - When the sidebar is OPEN, suppress toasts (the sidebar already shows the live state). Or place toasts near the sidebar's edge — pick whichever feels right; "suppress when sidebar open" is simpler.
- **Refs:** Launcher lives in `extension/replays/05-footer.js`'s `buildLauncher()`. The recorder fires `B().uploadReplay(...)` on finalize in `extension/replays/03-recorder.js` — the success/failure branches are the ideal triggers for the upload toasts. Tag-add lives in `R().addTag()` and `P().addTag()`. Style the pill to match the launcher's gradient + brand-blue border palette.

### [B19] Extension: replace the action popup with a karabuddy redirect

- **Why:** The toolbar action popup currently surfaces deck-setup / solo-launch UI. With everything moving to karabuddy and solo staying as its own future task, the popup's content is duplicate or stale. Simplify it to a launcher into karabuddy.
- **Acceptance:**
  - `extension/popup.html` rewritten to a small (300×180-ish) panel with the KARA/buddy logo and three big buttons: `My replays` → `<karabuddyEndpoint>/replays?tab=mine`, `Browse public` → `<karabuddyEndpoint>/replays?tab=public`, `Solo testing` → opens the existing solo-config screen (`options.html`). Each opens in a new tab via `chrome.tabs.create`.
  - `extension/popup.js`: drop the deck-library + config code; replace with three small click handlers + the existing `getKarabuddyEndpoint` call.
  - `extension/popup.css`: simplified to match the new minimal layout. Reuse the popup's existing dark/Barlow aesthetic.
  - `extension/options.html` (the deck library / solo setup): leave intact. Solo testing still needs it.
- **Refs:** `extension/popup.html`, `extension/popup.js`, `extension/popup.css`. `extension/background.js` has `getKarabuddyEndpoint`.

## Continuation prompt

A new chat can be bootstrapped with the prompt at `scripts/continuation-extension-rework.md`. Hand the user that file's contents and they're ready to `/clear` and start fresh.

## In Progress

_empty_

## Done

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
