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

### [B9] Monorepo: bring the chrome extension into the karabuddy repo

- **Why:** Today the extension lives at `~/code/karabast-extension/` and karabuddy at `~/code/karabuddy/`. They're co-evolving (bridge content script, upload endpoint, claim flow) and the cross-repo coupling already requires juggling two checkouts. A monorepo keeps the API contract + extension client + bridge content script in one place.
- **Acceptance:**
  - Extension code lives under `~/code/karabuddy/extension/` (or similar — pick a name).
  - Build/dev scripts adapted (the extension's "build" is just zipping/loading-unpacked; doc the workflow in karabuddy's CLAUDE.md).
  - Shared types between extension uploads and the API can live in a `packages/shared/` or `lib/shared/` dir if useful (not required for v1).
  - Existing standalone `~/code/karabast-extension/` git history is preserved via subtree merge OR a clean migration commit that notes the source provenance.
  - Karabuddy's deploy is unaffected (extension files aren't bundled into the Next.js build).
- **Refs:** Extension currently at `~/code/karabast-extension/`. Two cross-repo touchpoints we maintain manually today: `karabast-extension/karabuddy-bridge.js` (talks to karabuddy origins) and `karabast-extension/background.js`'s `KARABUDDY_DEFAULT` endpoint.

## In Progress

_empty_

## Done

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
