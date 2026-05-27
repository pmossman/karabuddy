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

_empty_

## Continuation prompt

## Continuation prompt

A new chat can be bootstrapped with the prompt at `scripts/continuation-extension-rework.md`. Hand the user that file's contents and they're ready to `/clear` and start fresh.

## In Progress

_empty_

## Done

### [B22] Extension: launcher grows in place + remains draggable while expanded
_completed: 2026-05-26_
Replaces B20's separate-panel design with a single grow-in-place element. The launcher is now one `<div>` with two children: a header (KARA/buddy + optional REC indicator + × close) and a body (idle or recording content). Collapsed = header only at auto-width; expanded = same header + body underneath at 300px wide. The whole element is one DOM node, so drag still works while expanded — the header acts as the drag handle in both states (4px click→drag threshold preserved). Edge-detection on expand shifts the launcher's top-left to fit the viewport (not restored on collapse — user accepts the shift, and can drag from there). Outside-mousedown still collapses. Interactive children in the body (link buttons, tag form, save/cancel, × close, anchor link, textarea) stop mousedown propagation so they don't accidentally start a launcher drag. Toast anchoring (B18) still works because the root element ID and identity are preserved; toasts now anchor to the expanded rect's right edge when the launcher is expanded. Reduced from 776 → 736 lines via dedupe (single drag/click handler set on the header; idle/recording body builders return element arrays instead of full panel shells).

### [B21] Extension: keep floating launcher always visible + idle-mode panel
_completed: 2026-05-26_
Reverses B20's hide-when-idle choice: the floating launcher is now always shown on karabast.net as the "extension active" indicator. The REC sub-indicator inside the launcher stays hidden until the recorder catches its first gamestate (so a pulsing red dot only ever means "actively capturing"). Panel content branches at open time: **recording mode** (existing REC header + tag controls + recent tags + open-on-karabuddy link) when active, **idle mode** when not — a small karabuddy.app launcher with `My replays →`, `Browse public replays →`, `Link this extension →`. Idle mode replaces the launcher role the deleted toolbar popup used to play, so users have a karabast.net-side entry point to karabuddy.app without juggling tabs. `openReplaysPage` in `background.js` extended to accept `{ tab: 'mine' | 'public' }`; `NS.bridge.openReplays(tab)` added in `01-namespace.js` for the MAIN-world content scripts. Panel-mode mismatch (state flips while panel open) triggers a close so the next reopen rebuilds in the correct mode — the toast that fires around the transition already tells the user what happened.

### [B20] Extension: collapse to floating-button-only + cut in-place playback + cut popup
_completed: 2026-05-26 by autonomous-loop_
Net -1236 lines. Slide-in sidebar gone — replaced by an expanding floating panel anchored to the launcher: collapsed shows REC + event count (hidden entirely until the recorder sees its first gamestate via new `R().isRecordingActive()`); expanded contains REC header, `+ Tag this moment` (inline textarea + Save/Cancel), recent tags list (last 5), and a hidden `Open on karabuddy →` link gated on a new `R().getCurrentKarabuddyUrl()` (cached on upload success, cleared at the start of each new recording). Edge-detection opens the panel leftward/upward when near the viewport edge. Dismiss: outside-mousedown or explicit `×`. Drag (B16) disabled while expanded. Launcher element identity preserved so B18 toasts keep anchoring; toasts no longer suppressed (no sidebar to suppress against). **Deleted:** `extension/replays/04-playback.js` (in-place playback was duplicated by karabuddy.app's `/r/[slug]` viewer with a fragile dep on karabast.net's socket.io protocol), `extension/popup.html|js|css` (replaced by a `chrome.action.onClicked` handler in `background.js` opening `<endpoint>/replays?tab=mine`). Also dropped: `REPLAY_FLAG` / `extReplay` URL flag / `consumePendingReplay` bridge in `01-namespace.js` + `06-bootstrap.js`, `playReplay`/`consumePendingReplay` handlers in `background.js`, `getKarabuddyEndpoint` message handler (popup-only, no longer needed). Preserved: solo testing functional path (`Cmd+Shift+S` hotkey + options-page config), DNR cookie-strip rules, recorder + upload + decoder, karabuddy-bridge.js. **Punted/regression flag:** the in-page solo-state controls that lived in the old sidebar (side card, swap/configure buttons) went with the rewrite; solo still works via hotkey + options page but has no in-page surface anymore. **Polish flag:** 05-footer.js (685 lines) uses an inline-styles-as-array-joins pattern that could be trimmed with an injected stylesheet.

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
