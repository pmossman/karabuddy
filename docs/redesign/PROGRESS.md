# Replay Viewer Redesign — Progress Log (B216)

> **Living state for the overnight build loop.** If you're a fresh/compacted
> context picking this up: read `VISION.md` first, then this file's **Resume**
> and **Next steps**. Update this file every iteration.

## Resume (how to pick up)

- **Worktree:** `/Users/parker/code/karabuddy-viewer-redesign` — branch `redesign/replay-viewer`.
- **Dev server:** port **3006** (`npx next dev -p 3006`, runs against local Docker
  Postgres :5434 = prod snapshot, via copied `.env.development.local`). Main-line
  dev (other worktrees) uses :3001 — don't touch it.
- **Sample replays (local DB):** `r_nwb6u5` (HAS tags — use this), `r_5yyp86`.
  Viewer URL: `http://localhost:3006/r/r_nwb6u5`.
- **Redesign flag:** the new layout renders when the viewer URL has `?redesign=1`
  (so the old viewer stays intact for comparison). Screenshot both.
- **Screenshots:** chrome-devtools MCP tools (load via ToolSearch
  `select:mcp__chrome-devtools__navigate_page,...`). Resize to the 4 aspect
  ratios in VISION.md acceptance. Save shots under `docs/redesign/shots/`.
- **DO NOT ship to prod.** Commit freely to `redesign/replay-viewer` only.

## Status

- **Phase:** 0 → 1 (scaffolding the feature-panel system).
- **Last updated:** 2026-06-30 (initial setup).

## Plan (phases)

- **P0 — Scaffold + baseline.** Worktree, dev server, docs. Baseline screenshots
  of the CURRENT viewer at all 4 aspect ratios (document the problem). ⏳
- **P1 — Layout primitive + bubble rail.** `useViewerLayout()` (size → mode),
  one `openFeature` state, `<FeaturePanel>` (right-docked drawer on desktop /
  full-height sheet on mobile), a bubble rail of feature icons. Gate behind
  `?redesign=1` in `ReplayViewer`.
- **P2 — Tags feature.** Extract a `<TagsFeature>` from `TagSidebar` logic;
  readable multi-tag card layout; full-screen mobile / docked desktop. THE
  priority. Reuse tag fetch/mutations/scope/review-status as-is.
- **P3 — Game Log feature.** Second feature on the same primitive (proves it
  generalizes); kill mobile/desktop duplication for it.
- **P4 — Polish + verify.** Bubbles for Info/Decks/Resourcing/Clip wired to the
  rail; screenshot sweep at all ratios; flip `?redesign=1` to default in the
  worktree once solid; finalize docs.

## Decisions log

- 2026-06-30: Symlinking node_modules into the worktree breaks Turbopack
  ("symlink points out of filesystem root") → did a real `npm ci` in the worktree.
- 2026-06-30: Build the new system **behind `?redesign=1`** rather than ripping
  out the old viewer, so the viewer stays usable all night and old/new are
  screenshot-comparable. Flip to default only once the MVP is solid.

## Screenshot log

(append: ratio → file → observation → action taken)

## Next steps

1. Confirm dev server on :3006 serves `/r/r_nwb6u5`.
2. Load chrome-devtools MCP screenshot tools; capture BASELINE of current viewer
   at 390×844, 844×390, 768×1024, 1440×900 → `docs/redesign/shots/baseline-*`.
3. Build P1 (layout primitive + bubble rail + `?redesign=1` gate).
4. Build P2 (Tags feature). Screenshot-verify each step.

---
### Log: 2026-06-30 — P0 done
- Worktree + :3006 dev (KARABUDDY_TEST_API=1 for authed screenshots) + docs up.
- `shoot.mjs` harness works: signs in as a replay OWNER (sees all tags, B131),
  screenshots 4 ratios → `shots/`. Baselines captured (`baseline-*`) using
  `r_euxnsk` (19 tags, owner user162@example.com).
- Baseline confirms: desktop = board + docked right drawer (tags/log) — fine;
  mobile portrait = board + scattered FABs, review sheet closed by default
  (cramped when opened, per Parker's shots).
- Next: read ViewerShell render → gate new chrome behind `?redesign=1`.

---
### Log: 2026-06-30 — P1+P2 shipped to branch (commit e1cdd93)
**Working** behind `?redesign=1` (view `http://localhost:3006/r/r_euxnsk?redesign=1`):
- `redesign/FeaturePanel.tsx` — docks (desktop) / full-screen overlay (mobile).
- `redesign/RedesignChrome.tsx` — bubble rail + openFeature state; Tags wired,
  Log/Info/Decks = placeholder bubbles.
- `redesign/TagsFeature.tsx` — readable tag cards (author dot, frame-jump pill,
  comment, scope, nested replies), grouped This frame / Upcoming / Previous.
- `ReplayViewer.tsx` gates TagSidebar vs RedesignChrome on the flag.
- Screenshots: `shots/v2-*` (default) + `shots/v2-open-*` (Tags opened). Mobile
  full-screen Tags reads great (multiple tags at once) ✅; desktop dock good ✅.

**Known issues / next (priority order):**
1. **Clutter (Parker's #1 gripe):** the rail currently OVERLAPS the old board
   FABs (frame-nav chevrons center, ✂/ⓘ top-right, playback bottom-right) — the
   redesign must REPLACE that chrome, not add to it. Plan: under the flag,
   suppress the matchup/clip/review FABs (they become rail features) and keep
   only playback + frame-nav (board controls). Then the rail is the single home.
2. **Composer:** TagsFeature is read-only — add "+ tag this frame" + reply
   (reuse the sign-in gate; POST /api/replays/[slug]/tags; append to setTagState).
3. **Game Log** feature on the rail (ViewerShell has `messagesByFrame`) — proves
   the pattern generalizes (the other desktop companion Parker named).
4. Info (matchup) + Decks features → rail. Then flip `?redesign=1` to default.

**Resume:** dev server :3006 (KARABUDDY_TEST_API=1). Shoot:
`node docs/redesign/shoot.mjs r_euxnsk user162@example.com <label> "?redesign=1" 'button[aria-label="Tags"]' mobile-portrait`
