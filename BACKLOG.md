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

### [B32] Fix: preserve recorder's POV (which side of the board is "you")
_completed: 2026-05-26_
karabast's `gameState.players` is keyed by user ID and the map's key order is arbitrary — `ReplayViewer.tsx` was picking `Object.keys(players)[0]` for the "connected player", which rendered the wrong side at the bottom whenever karabast happened to put the opponent's ID first in the map. **Recorder (`extension/replays/03-recorder.js`):** on first gamestate, capture `localStorage.getItem('anonymousUserId')` (karabast's local-user key for anonymous play); if that ID is one of the player keys in the gamestate, stash it as `localPlayerId` and include it in `buildPayloadText`'s payload. Cleared in `resetRecording()` so subsequent matches capture their own. **Decoder (`lib/replayDecoder.ts`):** plumb `localPlayerId` through `meta`. **Viewer (`app/(app)/r/[slug]/ReplayViewer.tsx`):** prefer `result.meta.localPlayerId` when it exists and matches a player key; fall back to `Object.keys(players)[0]` for older replays that predate the field. Logged-in karabast users (rare for karabuddy's audience) aren't detected today — they hit the fallback path and may still see flipped sides; follow-up if it becomes a real issue.

### [B31] Fix: toast positions BEFORE launcher REC indicator reveals (race)
_completed: 2026-05-26_
B30 bumped the toast's anchor offset but the real bug was a sync race. The recorder fires `T().show('Recording…')` BEFORE `F().refreshOverlay()` in the same first-gamestate branch. At the moment `show()` measures the launcher's `getBoundingClientRect()`, the REC sub-indicator is still `display: none` — so the launcher's right edge is narrower than it'll be 1 microtask later when refreshOverlay reveals REC and the launcher grows to fit. Result: the toast positions at the narrow-launcher's right edge + 18px, then the launcher grows past that point and overlaps. Fix in `07-toast.js`: call `positionContainer(container)` a second time inside the entry-animation rAF callback, after all sync DOM updates from the same event loop have settled. Initial sync positionContainer call kept for the case where no sibling layout change is pending.

### [B30] Extension: fix toast pill overlapping the launcher
_completed: 2026-05-26_
B18 toasts emerged too close to the launcher's right edge — visible in the wild as the `Recording…` pill abutting/overlapping the launcher border. Two small bumps in `07-toast.js`: `ANCHOR_OFFSET` 10→18 (visible breathing room between launcher and pill), and the stale `LAUNCHER_SIZE = 42` fallback constant updated to `LAUNCHER_FALLBACK_SIZE = 28` to match B27's shrunk launcher (only matters for the launcher-not-yet-in-DOM fallback path, but worth correcting for hygiene).

### [B29] Extension: pagehide upload safety net (close-tab data-loss fix)
_completed: 2026-05-26_
Closes the close-tab gap B26 explicitly punted on. Without this, closing the karabast.net tab within the first 5 min of a match (before the periodic snapshot timer fires) loses the replay entirely from karabuddy.app's perspective — the JS context dies before any upload can complete. Added a `pagehide` listener in `03-recorder.js` that, when fired with `gamestateCount > 0` AND `distinctActivePlayers >= 2`, builds the current payload with `reason: 'pagehide'` and fires `B().uploadReplay(payloadText)` fire-and-forget. The bridge → service-worker → fetch path is the trick: MV3 service workers outlive the originating tab by ~30s, plenty of time for the POST to complete, and the service worker's fetch from the extension origin doesn't need a CORS preflight. Sidesteps `navigator.sendBeacon`'s cross-origin-JSON-preflight issue and `fetch keepalive`'s 64KB payload cap entirely. The response event has nowhere to land (page is gone) but we don't care — the server-side upsert handles it.

### [B28] Fix: restore the WebSocket interceptor lost in B20
_completed: 2026-05-26_
Regression fix. Pre-B20 the `window.WebSocket` Proxy that called `R().attachInterceptor(ws)` for every karabast.net socket lived inside `04-playback.js` (bundled with the FakeWebSocket setup for in-place playback). B20 deleted that file to cut in-place playback and the Proxy went with it — recorder's interceptor entry point disappeared and karabast WebSockets stopped being captured. The recorder's exported `attachInterceptor` had zero callers since B20; nobody noticed until a real match was attempted. Reinstalled the Proxy at module-load time in `03-recorder.js` itself, just before the `NS.Recorder = {...}` export, so the recorder now owns its own WebSocket lifecycle (cleaner than the old cross-file split). Lazy `NS.Recorder?.attachInterceptor?.(ws)` lookup is safe because karabast's page bundle constructs its socket well after document_start (all content scripts finish loading first).

### [B27] Extension: shrink the collapsed floating launcher
_completed: 2026-05-26_
The pre-shrink launcher (42px tall, 12/10px stacked KARA/buddy) was taking too much real estate on karabast.net. Reduced: `LAUNCHER_MIN_HEIGHT` 42→28; header padding 10→7px; KARA 12→10px; buddy 10→8px (margin-left 6→4px); REC dot 8→6px (gap 6→4px, padding-left 6→5px); REC count 11→9px; × close 22→18px / 18→15px font. Same proportions, ~33% less footprint. Expanded panel body content (300px wide, link buttons, tag form, recent tags) kept at original sizes — those are readable-by-design.

### [B26] Snapshot-mode replays: periodic mid-match uploads
_completed: 2026-05-26_
Mitigates tab-close / lobby-disconnect / browser-crash data loss. Previously the extension only pushed a replay to karabuddy.app at clean game-end; anything that prevented the recorder from reaching `download()` left the replay local-only (or evicted from localStorage by the next match's gameId mismatch). Now: **extension** fires `snapshotUpload()` every 5 min during an active recording that's crossed the worth-keeping threshold (≥2 distinct active players). Snapshots are silent — no toast, no IDB write — and only update the cached `currentKarabuddyUrl` on success, so the floating panel's `Open this replay on karabuddy →` link surfaces during the match instead of only at game-end. Periodic timer starts on first gamestate of a new recording AND on successful localStorage restore (mid-game refresh); stops on `download()` and `resetRecording()`. Helper `buildPayloadText(reason, durationMs, actionCount)` extracted so finalize + periodic share the same shape; only the `reason` field differs (`auto` / `game-changed` / `manual` / `periodic`). **Server** (`app/api/replays/route.ts` POST): the existing dedupe-by-gameId fast-return becomes a full upsert path. Same-owner (or same-user via linked install) re-uploads now **overwrite** the existing blob, refresh metadata (`durationMs`, `actionCount`, `payloadSizeBytes`, `players`), promote `userId` if the install has since linked an account, and upsert payload-carried tags via `onConflictDoUpdate` (so extension-side tag edits during a match propagate; karabuddy-side edits post-finalize aren't touched because no more uploads happen). Different-owner uploads keep today's behavior (return existing slug, `deduped: true`) — both-players-have-extension is a separate problem that wants a `(gameId, ownerToken)` unique constraint. **Stale-snapshot guard:** server rejects writes with `actionCount` strictly less than the saved row's `actionCount` (`staleSnapshot: true` flag in response). Protects against a slow periodic landing after a fast finalize and rolling state back. `@vercel/blob` is 0.27.3, which silently overwrites with `addRandomSuffix: false`; no `allowOverwrite` flag needed at this version. **Known limitation:** lose up to 5 min of recording on tab close mid-match between snapshots; the obvious next step is a `pagehide` beacon, deferred for now (cross-origin sendBeacon + JSON content-type is fiddly and `fetch keepalive` has a 64KB cap that long matches exceed).

### [B25] Extension: drop solo testing entirely (~1300 lines removed)
_completed: 2026-05-26_
Solo orchestration is structurally extension-only (needs DNR cookie isolation + DOM injection on karabast.net + chrome.commands hotkey + cross-window orchestration), so it can't move to karabuddy.app today; the long-term plan is to rebuild solo from forceteki *inside* karabuddy.app rather than driving karabast.net. For now: cut entirely from the extension. **Deleted:** `extension/solo-main.js` (178 lines), `extension/options.html`, `extension/options.js` (608 lines), `extension/options.css`, `extension/shared.css` (orphaned). **background.js rewritten** to ~193 lines (was 554) — kept the karabuddy endpoint/install-token helpers, IndexedDB replay store, `uploadReplayToKarabuddy`, `openReplaysPage`, and the message handlers the recorder/footer actually call (`uploadReplay`, `saveReplay`, `listReplays`, `getReplay`, `deleteReplay`, `openReplaysPage`). **content.js trimmed** from 244 → 34 lines — solo URL-flag plumbing, deck fetch/lobby create/join, and the spacebar focus-swap are gone; only the companion bridge remains. **manifest.json:** dropped `solo-main.js` from MAIN-world content_scripts, dropped `options_page`, dropped the `commands` block (Cmd+Shift+S swap-focus), dropped `declarativeNetRequest` from permissions (DNR was solo-only), dropped `api.karabast.net` from host_permissions, refreshed the description to drop solo references. **01-namespace.js:** dropped `openSoloOptions` from `NS.bridge`. **05-footer.js:** removed the `Solo practice →` button — idle panel now has just `My replays →` plus the auto-recording hint. **README.md** rewritten to drop solo + dead-playback references; karabuddy.com → karabuddy.app. Extension total: **2171 lines**, down from ~3483.

### [B24] Extension: swap "Browse public" for "Solo practice" in idle panel
_completed: 2026-05-26_
Replaced the `Browse public replays →` link in the idle floating panel with `Solo practice →` — opens the extension's options page (deck library + Side A/B config + start session) via a new `B().openSoloOptions()` bridge method that sends the existing `openOptions` message. Idle panel buttons now: `My replays →` / `Solo practice →`. Public-browse is still reachable via karabuddy.app directly.

### [B23] Extension: drop the karabast-side "Link this extension" button + dead claim code
_completed: 2026-05-26_
The idle floating-panel's `Link this extension →` button was redundant with karabuddy.app/claim's `AutoDetectExtension`, which already pulls the install token via `karabuddy-bridge.js`'s postMessage protocol. Removed the button from `05-footer.js`'s `buildIdleBody`. With no remaining callers, also deleted the dead claim plumbing: `openKarabuddyClaim()` function in `background.js`, the `openKarabuddyClaim` message handler, and the `openKarabuddyClaim` method on `NS.bridge` in `01-namespace.js`. `getKarabuddyInstallToken` stays — still used by the upload flow to attribute uploads.

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
