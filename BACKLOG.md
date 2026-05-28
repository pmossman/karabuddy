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

### [B42] Capture deck snapshot + match metadata (format, card pool, bo3 score) in replay payload

- **Why:** Two motivations.
  1. **Decks rot.** karabast deck links are mutable — the same URL can return different cards a week later if the user edited their saved deck. Replays without a snapshot of the actual cards played become harder to review over time.
  2. **Match context is currently lost.** A replay today carries player names, leader, base, action count — but not the format (Premier / Eternal / Open / Limited), the card pool (Current / NextSet / Unlimited), the bo3 game number, or the bo3 series score. All meaningful to the reviewer.
- **What we already know from `~/code/karabast-dev/forceteki-client/`:**
  - **In `gameState` (what we already record):** `players[id].cardPiles` has keys `hand`, `discard`, `resources`, `groundArena`, `spaceArena`, `capturedZone`, plus (implied) `deck`. The full starting 50 cards = sum of every pile at game start. Local player's piles contain full card data; opponent's hidden zones contain stubs (the asymmetry B33 already keys on).
  - **In `lobbyState` (we don't record yet):** the karabast client receives `lobbystate` events alongside `gamestate`. Confirmed fields on the lobbyState payload:
    - `gameFormat` (`SwuGameFormat`: `premier` / `eternal` / `open` / `limited`)
    - `cardPool` (`CardPool`: `current` / `nextSet` / `unlimited`)
    - `gameType` (`MatchmakingType`: `quick` / `privateLobby` / etc.)
    - `winHistory: { gamesToWinMode: 'bestOfOne' | 'bestOfThree', setEndResult: ... }` — wins per player + bo3 set end conditions
    - `users[].deck: { leader, base, deckCards, sideboard }` — registered deck WITH sideboard, per `ILobbyDeckData`. **This is the snapshot we want.** It's the karabast-resolved canonical list, not the raw deckLink URL.
    - `connectionLink`, `lobbyOwnerId`, etc. (irrelevant to us)
- **Acceptance:**
  - **Recorder additions** (`02-decoder.js` + `03-recorder.js`):
    - Intercept the `lobbystate` socket.io event in addition to existing `gamestate` events. Already trivial — `attachInterceptor` sees every WS message, just need a new event branch.
    - Cache the most recent lobbyState in the recorder. On first gamestate of a new match, snapshot the relevant fields into the upload payload.
    - `payload.match` = `{ format, cardPool, gameType, gamesToWinMode, currentGame, seriesScore }` (currentGame + seriesScore derived from winHistory). All fields optional — older replays where lobby state never arrived render as null.
    - `payload.decks` = `{ [playerId]: { leader, base, deckCards, sideboard } | null }`. Local player always complete (lobby state always carries the local user's deck); opponent complete IF karabast exposes opponent's lobby deck (need to verify), partial otherwise. For partial, also include `observed: [...]` — cards observed in play during the match.
  - **Server** (`app/api/replays/route.ts` POST):
    - Accept the new `match` + `decks` fields, persist as JSONB columns on the `replays` table (single migration). Single-row storage is fine — a complete deck is ~50 small objects, ballpark a few KB.
    - Surface in the GET response so the viewer can render without re-fetching the blob.
  - **Decoder** (`lib/replayDecoder.ts`): plumb both fields through `meta`. Graceful null on older replays.
  - **Viewer:**
    - Header chip on `/r/[slug]` showing format + cardPool + (if bo3) "Game N of 3 · 1-0".
    - New "Decks" tab/section in the sidebar (or a popover from a new "Decks" button) showing both players' lists. Card thumbnails with quantity badges. Opponent's partial list visually distinct from complete.
    - `/replays?tab=mine|public` card teasers also surface format + bo3 game number next to the existing matchup text.
- **Server-side dedup consideration:** B26's upsert path overwrites by gameId. Periodic snapshots should refresh `match.currentGame` + `match.seriesScore` (live during the match) but NOT clobber `decks` (those are fixed at match start). Add an "only set decks on first write" rule in the upsert.
- **Remaining open questions (need a live-match console probe to resolve):**
  - Exact event name karabast emits for lobby state: is it `lobbystate` (Game.context.tsx confirms this string) or something else mid-flight?
  - Does opponent's lobby deck come through, or is it server-redacted? Same masking question as gameState — but lobby state predates match start so might be uncensored.
  - When does the gameState's first FULL snapshot include all pre-mulligan cards vs the post-mulligan starting hand? (Matters for the deck-reconstruction-from-gameState fallback path if lobby capture fails.)
- **Why NOT just resolve deckLink server-side:** karabast lobbies do carry a `deckLink` URL (SWUDB / SWUStats). Resolving it post-upload would technically work but has three downsides vs capturing lobby-state directly: (1) third-party dependency for every replay upload, (2) staleness risk identical to the original problem if the user edits the deck before we resolve, (3) doesn't give us format / cardPool / bo3 — those are karabast-side only. Lobby-state capture handles all of it.
- **Refs:** `extension/replays/02-decoder.js` (new event-type branch alongside `gamestate`), `extension/replays/03-recorder.js` (lobbyState cache + payload integration), `app/api/replays/route.ts` POST, `lib/replayDecoder.ts` (plumb new meta), `app/(app)/r/[slug]/TagSidebar.tsx` or new `Decks.tsx` component, `app/(app)/replays/ReplayCard.tsx` (format chip). New Drizzle migration.

## Continuation prompt

## Continuation prompt

## Continuation prompt

A new chat can be bootstrapped with the prompt at `scripts/continuation-extension-rework.md`. Hand the user that file's contents and they're ready to `/clear` and start fresh.

## In Progress

_empty_

## Done

### [B51] Fix: upgrade subcard strip rendering as a solid black box
_completed: 2026-05-28_
Cards attached as upgrades render a thin colored bar at the bottom of the host card with the upgrade's name in black text on a colored aspect background (`upgrade-{aspect}.png` in `public/`). The bar was rendering as a solid black box with no name visible. Root cause: `cardUpgradebackground()` in `GameCard.tsx` (and the parallel `capturedCardBackground()` in `LeaderBaseCard.tsx`) returned relative URLs like `'upgrade-white.png'`. Upstream forceteki renders its gameboard at `/GameBoard` (one path segment), so a relative `url(upgrade-white.png)` in a CSS background-image resolves to `/upgrade-white.png` and hits the public asset. Our viewer is at `/r/[slug]/` (two segments), where the same relative URL resolves to `/r/<slug>/upgrade-white.png`, 404s, and falls back to the `Box`'s default-transparent background sitting on top of the card container's `backgroundColor: 'black'` — hence the black box. The Typography name was also invisible because it's `color: black` over that now-black background (would have been black-on-color if the PNG had loaded). Prefixed every `upgrade-*.png` return in both helpers with `/` so they resolve from the app root regardless of route depth. Identical to upstream files except for that single character per branch — same family of fix as B43/B50 but a URL-resolution issue rather than the S3 locale-segment patch.

### [B50] Fix: token art for newer named tokens (mandalorian-id) was 404ing
_completed: 2026-05-28_
Same root cause as B43, this time for tokens. `cards/_tokens/<format>/<id>.webp` worked for the old numeric-id tokens that karabast mirrors at the no-locale path, but newer named tokens like `mandalorian-id` are only served under the locale segment. Updated `s3Utils.ts` to build `cards/_tokens/en/<format>/<id>.webp` for all tokens — older numeric-id tokens are likely also mirrored at the en/ path (same as B43's pattern with cards) so the locale-prefixed form is safe across the board.

### [B49] Fix: tag author attribution — local user's tags landing under the opponent's name
_completed: 2026-05-28_
Same root cause as B32/B33: karabast's `players` map has arbitrary key iteration order. `getOrCreateAuthor` in `02-decoder.js` was walking `Object.values(players)` and returning the FIRST non-anonymous username it found — which is the opponent half the time. So Parker tagged a moment, mid-match, as ReprintConfiscate, and the tag came back attributed to SerRaf. Fix: `getOrCreateAuthor` now accepts `localPlayerId` (which the recorder already tracks per B33 via the hand-visibility asymmetry) and looks up that specific player's username directly instead of iterating. Falls back to the persisted `anon-XXXX` handle when `localPlayerId` is null (e.g. very early frames before any hand data is visible) OR when the local player is anonymous on karabast (no real username). Bumped to v0.4.4.

### [B48] Mobile viewer polish: hide header, kill timer, frame-in-URL, safe-area, step-mode access
_completed: 2026-05-28_
Batch from a live-on-localhost mobile tuning pass. **Horizontal scroll bleed** killed via `body { overflow-x: hidden }` in `globals.css` — the lifted forceteki gameboard occasionally renders absolute-positioned elements past the viewport edge on narrow widths (iPhone Pro Max landscape ~932px), which let the user scroll the chevrons partly off-screen. **Persistent header hidden** on mobile viewer pages: `ReplayViewer` toggles `html.kb-viewer-mobile` while mounted; CSS hides the `[data-kb-header]` header and zeroes `--kb-header-h` so the viewer's `calc(100vh - var)` math gives it the whole screen. A `← karabuddy` home link added to the new mobile-only drawer section preserves navigation. **Karabast's GameTimer removed** entirely from `OpponentCardTray` — replays have no live clock; the placeholder `0:00 / 0:00` was just visual clutter. **Frame-in-URL** via `?f=N` (1-based for human-friendly sharing); `next/navigation`'s `useSearchParams` reads the initial frame on mount (applies once frames decode + clamps to length), and a write-side effect mirrors `currentIndex` via `router.replace({ scroll: false })` on every change. **Step-mode toggle** added to the new mobile-only drawer section so users can switch the chevron overlay between Action and Frame stepping without leaving the viewer; segmented control reuses the existing `ModeSegmented`. **Safe-area insets** on the ☰ button (`bottom: max(12px, env(safe-area-inset-bottom))`) and FrameNavOverlay chevrons (`left/right: max(8px, env(safe-area-inset-{left,right}))`) so iOS home-indicator + notched landscape devices don't clip them. **Deferred**: karabast's intrinsic ~900-932px breakpoint causes a player hand / leader overlap. Likely a `theme.breakpoints.between('md', 'iphone14max')` rule in one of the lifted gameboard subcomponents — not investigated in this pass to keep scope tight.

### [B47] Mobile detection: catch phone landscape (was getting desktop chrome)
_completed: 2026-05-28_
The `useMediaQuery('(max-width: 767px)')` threshold caught phone portrait (390px) but missed phone landscape — iPhone 14 is 844px wide in landscape, iPhone 14 Pro Max is 932px. Those landed in desktop chrome with a full 360px sidebar eating ~40% of the viewport. Bumped to `(max-width: 900px), (pointer: coarse)` which evaluates as OR — any narrow viewport stays mobile, plus any touch device of any width also routes to mobile (catches tablets too). Desktop with a mouse stays desktop unless the window shrinks past 900px. CSS media-query syntax already treats comma as OR so no `useMediaQuery` changes needed.

### [B46] Mobile: gameboard-overlay frame nav chevrons + drop in-sidebar nav row
_completed: 2026-05-28_
Two-part mobile polish. **New `FrameNavOverlay`**: slim 36×84 chevron buttons pinned to the left + right edges of the viewport (mobile only — desktop keeps the existing in-sidebar arrows + keyboard nav). Translucent dark background with backdrop blur so it sits over the gameboard without dominating. The right chevron shifts left to `calc(drawerWidth + 8px)` when the drawer is open so it stays reachable; the slide animation matches the drawer's 220ms transition. Disabled state at frame boundaries fades to 40% opacity. **In-sidebar frame-nav section hidden on mobile**: that ~50px row (← Frame N/M → gear) is redundant once the overlay chevrons exist; freeing it gives the FrameLog more vertical room on the cramped mobile-landscape canvas. Drawer state lifted from `TagSidebar` to `ReplayViewer` (alongside `isMobile`) so the overlay can react — `TagSidebar` now receives `drawerOpen` / `setDrawerOpen` / `isMobile` as props.

### [B45] Fix: gameboard reserved ~20% right-padding for a chat sidebar we deleted
_completed: 2026-05-28_
Sharp-eyed visual catch from Parker — the gameboard always rendered with a noticeable right-side gap. Root cause: the upstream forceteki Gameboard reserves `pr: min(20%, 280px)` on its main box for the in-board ChatDrawer karabast.net uses. B4 deleted the ChatDrawer (the karabuddy viewer never has chat), and B5 hardcoded `sidebarOpen = true` because the comment-author thought the right-padding was reserving space for our TagSidebar. But the TagSidebar lives in a separate flex column OUTSIDE this gameboard, so the padding was always orphaned — just visible asymmetry. Flipped to `sidebarOpen = false`. Gameboard now renders edge-to-edge. Especially visible mobile-landscape, where the dead 20% chewed up the most precious horizontal real estate.

### [B44] Mobile: TagSidebar becomes a slide-out drawer on narrow viewports
_completed: 2026-05-28_
First fix for mobile viewer usability — phone-portrait users were getting ~30px of gameboard because the 360px-default sidebar consumed the entire viewport. Below 768px (matches the gameboard renderer's "needs ~700px to lay cards out" lower bound), the sidebar now: takes itself out of the flex flow via `position: fixed`, slides in from the right with a `transform` animation, fades a dim backdrop over the gameboard, and surfaces a floating "Tags · Frame N/M" pill at bottom-right to reopen when closed. Backdrop tap + an explicit × in the drawer header both dismiss. Desktop behavior unchanged — the existing draggable resize handle is hidden when mobile to avoid the dead-affordance. New `lib/useMediaQuery.ts` hook does SSR-safe `window.matchMedia` subscription (returns `false` until mount to avoid hydration mismatch). Auto-closes the drawer if the user resizes mobile → desktop while it's open. Skipped the simpler "force the gameboard to also be responsive" path — the lifted forceteki renderer assumes ≥700px and rewriting it is a multi-week project; the drawer at least unlocks landscape usability and lets portrait users skim through frames + tags even if individual cards stay hard to read at phone widths.

### [B43] Fix: card art for newer sets (ASH onward) was 404ing — missing `en/` locale segment
_completed: 2026-05-27_
Karabast's S3 layout is `cards/<SET>/<LANG>/standard/large/<N>.webp`, but our `/card-art` proxy + the lifted forceteki renderer both built URLs as `cards/<SET>/standard/...` (no locale). Older sets (SEC, etc.) happen to also be mirrored at the no-locale path so they kept working; newer sets like ASH (The Mandalorian leader) are locale-only, so we got 404s. **Proxy** (`next.config.ts`): inject `en/` between `<SET>` and the rest of the path — keeps the public `/card-art/<SET>/...` API surface unchanged. **Viewer renderer** (`app/_utils/s3Utils.ts`): same fix at the URL-build site, kept tokens at their no-locale path (tokens aren't localized). **Replay card thumbnails** (`lib/cardImage.ts`): cache-bust bumped `?v=2` → `?v=3` to match karabast's current asset version.

### [B41] Fix: surface a persistent toast when the extension context is invalidated
_completed: 2026-05-27_
After an extension reload or auto-update, content scripts already loaded into karabast.net tabs lose their handle to `chrome.runtime` — `chrome.runtime.sendMessage` throws `"Extension context invalidated"` and uploads / IDB saves silently fail until the user refreshes the tab. Surfaced this state to the user with a dismissible persistent toast: **`07-toast.js`** grew a `persistent: true` option (renders an `×` close button, no auto-hide, dedup-by-key so retries don't stack), plus a `warning` kind (orange). **`content.js`** detects context invalidation two ways — try/catch around `sendMessage` and a 5s watchdog that reads `chrome.runtime.id` (throws after invalidation) — and dispatches a `karabast-companion-context-invalidated` custom event into the page world. Also resolves any pending bridge request immediately with `ok: false` instead of waiting on the 15s timeout, so the recorder's error path runs while the user is still looking. **`06-bootstrap.js`** listens for the sentinel, sets `NS.contextInvalidated = true`, and fires the persistent warning toast: *"KaraBuddy was updated. Refresh this karabast.net tab to keep recording your matches."* **`03-recorder.js`** checks the flag before firing its generic `Upload failed` toast so the user doesn't get a duplicate complaint that doesn't explain the root cause. Auto-refreshing the karabast tab on `chrome.runtime.onInstalled` was considered and rejected — would disconnect users from in-progress matches.

### [B40] Fix: bridge mints install token lazily so fresh installs don't show "couldn't detect"
_completed: 2026-05-27_
Hit on a fresh-device install: visiting karabuddy.app/claim before recording any matches showed "We couldn't detect the KaraBuddy extension on this browser" even though the extension was installed and the bridge was responding. Root cause: the install token was only minted inside `getKarabuddyInstallToken()` in `background.js`, called only from `uploadReplayToKarabuddy()`. A fresh install with no matches yet had no token in `chrome.storage.local` — the bridge correctly returned `{token: null}`, and `requestInstallTokenFromExtension` (`lib/extensionBridge.ts:24`) collapses both "no response" and "null token" into the same null return, which `AutoDetectExtension` flips to the `'missing'` state. Fix in `extension/karabuddy-bridge.js`: when the storage lookup comes back empty, generate `kbx_<uuid>` and persist it before responding. Self-healing — every consumer (the bridge here, `getKarabuddyInstallToken` in background, the upload flow) now lands the same token on first read. Bumped to v0.4.2.

### [B39] Web Store listing assets + listing copy
_completed: 2026-05-27_
**Privacy email** updated to `swutrade@gmail.com` (was placeholder `parkermos@gmail.com`). **Screenshots** captured at 1280×800 via headless Chrome through agent-browser, saved to `assets/store/screenshot-{1-home,2-install,3-replays,4-viewer,5-privacy}.png`. **Promo source HTML** added at `extension/icons/promo-source.html` — same vw-based-units approach as the existing `source.html` so a single template renders at any of the Web Store's promo-tile aspect ratios (440×280, 920×680, 1400×560). **Generator script** at `scripts/generate-icons.sh` invokes headless Chrome to render both source HTMLs to PNGs (extension icon sizes + store icon + 3 promo tile sizes). Includes a 30s watchdog per render — Chrome occasionally hangs in headless mode waiting on Google Fonts. **Listing copy** at `docs/chrome-web-store-listing.md` — paste-ready name, short + detailed descriptions, single-purpose statement, per-permission justifications (`storage`, `tabs`, the karabast.net + karabuddy.app host permissions), privacy-disclosures checkbox grid, plus a pre-submission checklist. **Existing icons** at `extension/icons/{16,48,128}.png` from the original B15 programmatic generation are kept as-is — confirmed acceptable. Items still on Parker's plate: run `npm run generate:icons` once locally to produce the promo tiles (autonomous-run from this session hit Chrome-process contention with the parallel screenshot job), then the only remaining gates to Web Store submission are the $5 dev account + the listing fields paste-up.

### [B38] Web Store pre-submission punch list (privacy + bridge lockdown + console cleanup + claim discoverability)
_completed: 2026-05-26_
Four-part batch — everything required for store submission except the icons + the listing assets (those need actual artwork). **(1) Privacy policy** at `karabuddy.app/privacy` — covers install token, replay payloads, tags, optional sign-in profiles, what we DON'T collect (no marketing cookies, no analytics, no tracking pixels), third-party processors (Vercel, Neon, Discord, Google), replay visibility model, retention, user controls, deletion contact. New `app/_components/Footer.tsx` sitewide in the (app) route group with Privacy / Install / GitHub links. **(2) Bridge token-exposure lockdown** — `scripts/package-extension.sh` now stages the extension dir to a temp location, strips `*.vercel.app/*` and `http://localhost:3000/*` from the published `manifest.json` (host_permissions + bridge `content_scripts.matches`), and drops `icons/source.html` + `icons/raw-*.png`. Source `manifest.json` keeps the dev hosts so local development against `localhost:3000` still works. Zip dropped from 128KB → 56KB. **(3) Console noise** — `03-recorder.js`'s per-game `console.log` calls (`skipped save`, `finalized`, `uploaded to`) + `06-bootstrap.js`'s `loaded` log gated behind the existing `NS.dlog` helper. `console.warn` / `console.error` paths left alone (real-problem signals). **(4) Claim-flow discoverability** — new `MineEmpty` client component renders on `/replays?tab=mine` when a signed-in user has zero attributed replays. Probes the extension via the existing bridge: if it returns a token, banner says "We detected the KaraBuddy extension — Link this extension →" pointing at `/claim?token=...`. If no token, points at `/install`. Closes the B23-era gap where a fresh user could install the extension, sign in, see an empty page, and have no idea why their captures weren't showing up.

### [B37] TagRowView: explicit ✎ Edit button instead of click-to-edit
_completed: 2026-05-26_
Tag comments became a textarea only after clicking on the comment text itself, which overloaded click semantics (the row's outer click jumps to that frame, the inner click switched modes). Replaced with an explicit pencil-icon edit button next to the existing ✕ delete button in the right column of the row. Comment text is now a plain readonly div with `(no comment)` italic placeholder when empty (was `(click to add comment)` — that affordance is gone). Both buttons get hover-tints (edit → blue, delete → red) matching their action. Cmd/Ctrl+Enter to save, Esc to cancel, blur-saves still work in the edit textarea.

### [B36] Fix: edit/delete affordances on the "This frame" tag callout
_completed: 2026-05-26_
B7 wired tag-author edit + tag-author-or-replay-owner delete server-side and added the per-tag `canEdit` / `canDelete` computation in `TagSidebar`, but only on the "All tags" list. The prominent "This frame" callout at the top of the tag display area used a separate inline read-only renderer with no edit/delete buttons — so when sitting on a tag's frame (the natural place to act on it) you couldn't do anything to it. Swapped the inline renderer for the existing `TagRowView` with the same isAuthor / isOwner derivation as the other list, `isCurrent={true}` for the highlighted blue-tinted styling. Edit + delete now work from either list, consistent with the server's existing auth.

### [B35] Extension: switch to karabuddy.app for prod
_completed: 2026-05-26_
`background.js` `KARABUDDY_DEFAULT` flipped from `http://localhost:3000` to `https://karabuddy.app` so fresh installs point at production by default. `manifest.json` host_permissions + `karabuddy-bridge.js` `content_scripts.matches` swapped `karabuddy.com` → `karabuddy.app`; `*.vercel.app/*` preview hosts and `http://localhost:3000/*` dev host retained for preview-deploy claim flows + local development. Local dev override: `chrome.storage.local.set({ karabuddyEndpoint: 'http://localhost:3000' })`.

### [B34] Webapp polish: flush-left header logo + TagSidebar tag-controls reflow
_completed: 2026-05-26_
**Header** (`app/_components/Header.tsx`): dropped the `maxWidth: 1100` + `margin: '0 auto'` wrapper. On wide viewports the KARA/buddy logo was centered ~450px in from the actual viewport left; now it sits flush-left against the 28px page-edge padding. Nav stays right via `justify-content: space-between`. **TagSidebar** (`app/(app)/r/[slug]/TagSidebar.tsx`): `+ Tag this frame` button is now its own full-width row (new `fullWidth` prop on `FooterBtn`) at the top of the tag controls section — primary CTA above the tag list. Prev/Next tag nav split out of that row entirely; new section below the tag display area with the two buttons spread space-between (only rendered when `tags.length > 0`). Cleaner "review → skim → jump" flow than the prior "all tag actions clustered above the list."

### [B33] Recorder POV detection — use karabast's server-side hand masking
_completed: 2026-05-26_
B32 detected the local player by reading `localStorage.anonymousUserId`, which only works for anonymous karabast users. Replaced with a content-based detector that works for any karabast auth mechanism: karabast already server-side-masks each client's view — the local player's hand contains cards with full `.id` / `.setId` data, the opponent's hand contains stubs without that data (this is the asymmetry `stripHiddenHandCards` in `lib/replayDecoder.ts:31` was built to handle). `detectLocalPlayerId` now scans `players[*].cardPiles.hand` for the unique player whose hand has cards with visible data — that's the recorder's POV. Falls back to `Object.keys()[0]` only if zero players have visible cards (hands empty in very early game) or both do (spectator-style state). Detection runs on every gamestate until it locks in, so an empty-hand first frame doesn't permanently fail. Uses what karabast already sends; no internal-storage probing, no future-fragility against karabast auth changes.

### [B32] Fix: preserve recorder's POV (which side of the board is "you")
_completed: 2026-05-26_
karabast's `gameState.players` is keyed by user ID and the map's key order is arbitrary — `ReplayViewer.tsx` was picking `Object.keys(players)[0]` for the "connected player", which rendered the wrong side at the bottom whenever karabast happened to put the opponent's ID first in the map. **Recorder (`extension/replays/03-recorder.js`):** on first gamestate, capture `localStorage.getItem('anonymousUserId')` (karabast's local-user key for anonymous play); if that ID is one of the player keys in the gamestate, stash it as `localPlayerId` and include it in `buildPayloadText`'s payload. Cleared in `resetRecording()` so subsequent matches capture their own. **Decoder (`lib/replayDecoder.ts`):** plumb `localPlayerId` through `meta`. **Viewer (`app/(app)/r/[slug]/ReplayViewer.tsx`):** prefer `result.meta.localPlayerId` when it exists and matches a player key; fall back to `Object.keys(players)[0]` for older replays that predate the field. _Superseded by B33._

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
