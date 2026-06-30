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

---
### Log: 2026-06-30 (overnight) — de-clutter + composer + Game Log (commits b63a015, 8ee10cb, 3e21835)
**Done this loop:**
- **De-clutter** (b63a015): under ?redesign=1, suppressed old board FABs that
  become rail features (matchup ⓘ, Clip ✂, Jump-to) + old mobile sheets
  (MatchupPanel, backdrop). Kept frame-nav chevrons + tag-jump, playback, Pov.
  Rail moved to cleared top-right. Board reads much cleaner ✅.
- **Tag composer** (8ee10cb): "+ Tag this frame" → textarea → POST + optimistic
  append (original-frame space; viewer remaps). Signed-out = the prod sign-in
  gate. Verified desktop + mobile (`shots/compose-*`).
- **Game Log** (3e21835): second real rail feature — cumulative log, current
  frame highlighted, player colors; full-screen mobile / docked desktop. Verified
  at frame ~45 (`shots/gamelog2-*`).

**State:** rail has Tags + Game Log live; Matchup(⚔)/Decks(🃏) still placeholder.
Tags = read + compose. System (rail + FeaturePanel docking/full-screen) proven
across desktop + mobile.

**IMPORTANT GAP I created:** suppressing the old matchup FAB + the TagSidebar
header removed ALL matchup/player context under the flag (no players/leaders/W-L/
format shown). → NEXT priority: build a **Matchup (Info) feature** (players +
leaders + base + W/L + format; reuse matchMeta + replay.players + decks). Then
Decks feature. Then final all-ratios sweep.

**Default flip decision (judgment):** keep `?redesign=1` as a FLAG (not default)
so Parker can A/B vs the current viewer AND still use not-yet-migrated features
(Clip/Decks/Matchup) via the old viewer. Revisit once all features are migrated.

**Next steps (priority):** 1. Matchup/Info feature (closes the gap). 2. Decks
feature. 3. Reply composer on tag cards. 4. Final sweep + summary for Parker.

---
### Log: 2026-06-30 (overnight) — Matchup + Decks features; MVP COMPLETE (commits d68d390, + Decks)
- **Matchup (Info)** (d68d390): reuses shared `<MatchupInfo>` (variant=panel) —
  chips, editable title, leader/base thumbs, W/L, series + resourcing link.
  Restores the player/leader/format context de-cluttering removed.
- **Decks**: reuses canonical `<DecksTabs>` (player tabs, main/sideboard,
  seen-during-play via lazy payload decode). No placeholder bubbles left.
- Final all-ratios sweep (`shots/final-*`, `shots/final-open-*`): board + rail
  clean at 390×844 / 844×390 / 768 / 1440; every feature opens full-screen on
  mobile (portrait AND landscape read great) / docks on desktop.

## ✅ MVP COMPLETE — morning summary for Parker

**What it is:** one unified viewer chrome behind `?redesign=1`. A **bubble rail**
(Tags 🏷 / Game Log 📜 / Matchup ⚔ / Decks 🃏) + a single **FeaturePanel** that
**docks on desktop** (right of the board) and goes **full-screen on mobile** —
the SAME component, no separate view-models. The old TagSidebar + mobile-sheet
split is replaced; the board is de-cluttered (old matchup/clip/jump FABs gone
under the flag; only frame-nav + playback remain).

**Features (all work desktop + mobile, all 4 ratios):**
- **Tags** — readable roomy cards (author, frame-jump, comment, scope, nested
  replies) grouped This frame / Upcoming / Previous + **compose** ("+ Tag this
  frame", with the signed-out sign-in gate). The cramped strip is gone.
- **Game Log** — cumulative, current frame highlighted, player colors.
- **Matchup** — chips, title, leader/base, W/L, series, resourcing link.
- **Decks** — player tabs, main/sideboard, seen-during-play.

**How to review:** `http://localhost:3006/r/r_euxnsk?redesign=1` (drop the flag
for the current viewer to A/B). Screenshots in `docs/redesign/shots/`
(`final-*` = clean default, `v2-open-*`/`matchup-*`/`decks-*`/`gamelog2-*` =
each feature, `baseline-*` = current viewer). Branch `redesign/replay-viewer`,
NOT shipped to prod.

**Deliberately kept as a FLAG (not default):** lets you A/B and still use the old
viewer's not-yet-migrated bits. Flip the default once you're happy.

**Known follow-ups (not blocking):** reply composer on tag cards; the board
"Initiative" pill grazes a rail bubble in some states; tablet (≤900px) uses the
full-screen treatment — a "docked on tablet" mode could be nicer; migrate Clip +
Jump-to-moment onto the rail (currently suppressed under the flag); @mentions +
scope chip in the new composer (the old form had them).

**Loop stopped here** — MVP criteria met. Resume points above if you want more.
