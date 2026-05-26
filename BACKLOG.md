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

### [B1] Game board bottom is clipped under the persistent header

- **Why:** After adding the `(app)` layout's sticky header above the viewer, the gameboard's bottom row (player hand, deck, resources) is cut off. The viewer wrapper uses `height: calc(100vh - var(--kb-header-h))` but something in the gameboard tree is still computing against 100vh.
- **Acceptance:** Bottom row (hand, deck zone, resource pile) is fully visible at the default viewport. Open `/r/<any slug>` and confirm.
- **Refs:** Screenshot showed Qui-Gon Jinn / Rose Tico / Liberty / N-1 Starfighter / etc. row sliced off at bottom. Likely culprits: a nested `100vh` inside the lifted Gameboard component, or a fixed-height assumption in `Board.tsx`.

### [B2] Restore the per-frame "what happened" log in the sidebar

- **Why:** The chrome extension's playback sidebar surfaced a running log of events extracted from each gamestate (the "what happened this frame" + dimmed history of prior frames). karabuddy dropped this during the renderer lift and it was one of the most useful playback affordances.
- **Acceptance:** Viewer sidebar shows current-frame log entries at full opacity and prior frames dimmed (matching extension behavior). Stepping forward pushes the "current" focus to the new frame.
- **Refs:** Implementation reference in `~/code/karabast-extension/replays/05-footer.js` — search for "messagesByFrame" + the `logHeader` / `logBody` block. The decoder already produces `messagesByFrame` (see `lib/replayDecoder.ts`).

### [B3] When at a tag's frame, don't duplicate it in the All Tags list

- **Why:** The viewer's sidebar shows a prominent "THIS FRAME" callout for tags anchored at `currentIndex`, AND the same tag re-renders in the "All tags" list below. Reads as duplicated content.
- **Acceptance:** When a tag appears in the THIS FRAME callout, hide it from the All Tags list (or visibly dim it so it's clearly the same item, not two).
- **Refs:** `app/(app)/r/[slug]/TagSidebar.tsx` — `tagsAtCurrent` is rendered as a callout, then the full `tags` array is rendered in the list below. Filter out `t.frameIndex === currentIndex` from the list when building the second loop.

### [B4] Opponent hand card backs render as solid black

- **Why:** We pointed CosmeticsContext's default cardback at `/card-back.png`, which fixed the deck/discard pile backs but the opponent's hand cards (top row) still display as plain black rectangles.
- **Acceptance:** Opponent hand at every frame shows the same Star Wars cardback as the player's deck pile.
- **Refs:** Latest viewer screenshot — top row of 6 dark rectangles where opponent hand would be. Either the hand zone uses a different cosmetic getter, or the HIDDEN_DATA_CARD_ID styling we ported in `lib/replayDecoder.ts` is hiding cards entirely instead of showing them with a back. Check `Decoder.installHiddenCardStyles` equivalent on the karabuddy side.

### [B5] Strip non-functional interactive UI from the replay viewer

- **Why:** The lifted gameboard includes karabast's X (close), gear (settings/preferences), and chat expand/collapse buttons. None of them do anything in a replay context and they invite mis-clicks.
- **Acceptance:** Those three controls (top-right X, top-right gear, bottom-right chat bubble) are hidden in the replay viewer. Replay-specific affordances (frame stepping, tagging) stay.
- **Refs:** Visible in the same screenshot as B1. Likely candidates: `app/_components/Gameboard/Board/Board.tsx` and `app/_components/Gameboard/_subcomponents/Overlays/` (some of which the lift agent already removed). The X may be from `LeaveButton` or similar.

### [B6] Share affordance in the viewer (copy link + public toggle)

- **Why:** Owner can flip visibility from the `/replays` page row controls, but the viewer itself has no Share button. Friction for the share-by-link workflow that's the whole point of karabuddy.
- **Acceptance:** Viewer sidebar (for owner only) has a "Share" button that copies `https://karabuddy.com/r/<slug>` to clipboard with a toast confirmation, plus a visible public/unlisted state pill. Non-owners see neither — just the copy button if visibility is public.
- **Refs:** `app/(app)/r/[slug]/TagSidebar.tsx` for placement. API already supports `PATCH /api/replays/<slug>` with `{ visibility }`.

### [B7] Refine tag ownership: replay owner can delete, only author can edit

- **Why:** Today tag mutation is purely author-locked (you can only edit OR delete your own). That blocks the replay owner from cleaning up spam comments on their own replays. Need a more nuanced rule.
- **Acceptance:**
  - As tag author: see Edit + Delete on my own tags.
  - As replay owner (but not author): see Delete on tags by others; no Edit (don't put words in their mouth).
  - As neither: see neither.
- API: `DELETE /api/replays/[slug]/tags/[id]` allows if caller is tag author OR replay owner. `PATCH` stays author-only.
- **Refs:** `app/api/replays/[slug]/tags/[id]/route.ts` (`canMutate` helper). Viewer UI in `TagSidebar.tsx` — `isOwn` currently drives both edit and delete; split into `canEdit` + `canDelete` driven by whether viewer is tag-author and/or replay-owner.

### [B8] Hint keyboard navigation on the prev/next frame arrow buttons

- **Why:** The viewer's ← and → buttons step frames, but it's not obvious that the keyboard arrow keys also work. Discoverability issue.
- **Acceptance:** Hovering the arrow buttons shows a tooltip like "Previous frame (←)" / "Next frame (→)". Optionally a small hint line under the buttons. Keep the existing "Hold ⇧ + ← → to step by Frame" hint that's already there for the mode flip.
- **Refs:** `app/(app)/r/[slug]/TagSidebar.tsx` — the `FooterBtn` components for `←` and `→` already accept onClick; add `title=` attributes.

## In Progress

_empty_

## Done

_empty_
