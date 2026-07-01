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

---
### Log: 2026-06-30 — Tag Mode (interactive feel iteration with Parker)
Mobile tag UX evolved from the full-screen list into a board-visible "Tag Mode":
- Floating, draggable bubble over a visible board; clamped on-screen (can't fling
  off); compose lives IN the bubble (footer), not an orphaned pencil.
- Prev/next tagged-frame nav moved INSIDE the panel (preview row under header).
- UNIFIED: the rail Tags icon IS the minimised panel — shows a current-frame tag
  COUNT badge; tap expands the floating window; ✕ collapses back. No separate
  tuck tab / edge chips.
- Desktop keeps the docked side-panel (board visible alongside); count badge on
  the icon there too.
- Fixes: desktop chevron/playback now position against the redesign dock width
  (RedesignChrome reports it) not the old TagSidebar; Upcoming/Previous sidebar
  tags fade by rank so the current frame stays prominent.
Files: redesign/TagReadMode.tsx, tagCompose.tsx (shared compose hook+CTA),
RedesignChrome.tsx, TagsFeature.tsx, ReplayViewer.tsx. Branch only; not shipped.
OPEN: desktop adopt the same single-frame floating model? tablet docked mode?

---
### Log: 2026-06-30 — glassy Tag HUD + frosted rail (Parker's iOS direction)
- **TagHud.tsx**: glassy/translucent iOS-style bubble centred on the BOARD (both
  sizes) = the PRIMARY current-frame tag surface. Shows the frame's tag(s)+replies,
  minimal controls (add / reply via parentTagId / prev-next tag with shortened
  preview), board reads through it. Centres on the board region on desktop
  (shifted by the sidebar width).
- **Feed** = desktop docked sidebar (TagsFeature, all tags, current highlighted +
  distance-fade) / mobile full-page takeover via the HUD's ≣ button.
- **Rail**: frosted-glass buttons + minimal stroke SVG icons (tag/list/chevrons/
  cards) replacing skeuomorphic emoji.
- Compose gate: anonymized viewers see a note, can't tag (UI only; B218 filed on
  main for server enforcement).
- Retired TagReadMode (top-anchored draggable bubble) in favour of the HUD.
- Shots: hud-tag-desktop / hud-tag-mobile (comment in glass), hud2-mobile (rail).
- OPEN/consider: a very long comment makes the centred glass tall (scrollable +
  translucent mitigates); consider a collapse/expand or a max-lines "more".

---
### Log: 2026-06-30 — HUD ⟂ sidebar decoupling + drag/resize/recenter
- **TagHud**: whole-panel drag (chrome; body/controls opt out), bottom-right
  resize grip (centre-anchored math keeps top-left put), re-center button (resets
  pos+size), minimize (−) / expand (⤢). Verified resize + recenter by measurement.
- **RedesignChrome** state split into TWO independent surfaces (desktop + mobile
  unified): `hudOpen` (the Tag HUD overlay, toggled by the Tags rail icon) and
  `panelView` (docked sidebar / full-page: tags-feed | log | info | decks, toggled
  by its rail icon; feed also opens from the HUD's ≣). The HUD is usable with the
  panel collapsed, stays open across panel view changes, and a feed-entry click
  opens the HUD + jumps (mobile closes the full-page feed). HUD re-centres on the
  board region when the sidebar docks (sidebarW = desktopDock ? 380 : 0).
- **Feed** (TagsFeature): condensed chronological timeline (start→end), current
  lit, others equally dimmed, click-to-jump, auto-scrolls to current; browse-only.
- **Nav**: tag-to-tag uses «/» + author dot (distinct from single-chevron frame
  steppers).
- Shots: decouple-default (HUD standalone), decouple-decks (HUD + Decks sidebar),
  decouple-feed (HUD + docked feed).

---
### Log: 2026-06-30 — rail/sidebar split (current-frame vs whole-replay)
- Conceptual model (Parker): RAIL = current-frame actions; SIDEBAR = whole-replay
  views behind a selector.
- **Rail** (RedesignChrome): Tags (HUD toggle) · Play/Pause · Jump-to · Clip ·
  Sidebar-toggle. Play/pause → toggleAutoplay; Clip → opens ClipBuilder; Jump →
  glassy chapter menu (JumpMenu, from lib/replayChapters).
- **Sidebar**: one toggleable surface — resizable dock (desktop, left-edge handle,
  300–50vw) / slide-out drawer (mobile, ~92vw + backdrop). Glassy. A scrollable
  view SELECTOR (FeaturePanel `toolbar`) switches: Tags feed · Log · Matchup ·
  Decks · Playback · Share · Clips.
- New views: PlaybackFeature (play/speed/step-mode/animate), ShareFeature (copy
  link + ShareWithTeam), ClipsFeature (ClipsList + new-clip). icons.tsx = shared
  line-icon set.
- ReplayViewer passes a `controls` bundle (playing/onTogglePlay/speed/speeds/
  onSetSpeed/animate/onToggleAnimate/stepMode/onSetStepMode/chapters/onOpenClip/
  clips/installToken/isOwner) and now GATES the old StepModeOverlay + MobileControlsFab
  on `!redesign` (playback lives in the rail + sidebar). FrameNav chevrons + ClipBuilder
  stay shared.
- Glassy finish extended to FeaturePanel (dock + drawer), the view selector, and JumpMenu.
- Shots: rail5, sb-playback, jumpmenu (desktop); m-rail, m-drawer (mobile).
- NOTE: mobile dev shots show a "N issues" badge = Next.js dev overlay (unrelated to UI).

---
### Log: 2026-06-30 — controls polish (play FAB, glassy chevrons, POV→playback)
- Play moved OUT of the rail into a larger standalone glassy FAB (58px) bottom-right,
  dock-aware (its pre-redesign home). Rail is now Tags · Jump · Clip · Sidebar.
- Frame-nav chevrons got the frosted-glass treatment (shape kept) + the ←/→ keyboard
  hint keycaps dropped in redesign (FrameNavOverlay gains a `glassy` prop; ReplayViewer
  passes glassy + showKeyboardHint=false under redesign).
- Jump-to rail icon reverted to the original map-pin glyph (ChaptersGlyph) to avoid
  churn.
- Sidebar header dropped (FeaturePanel `hideHeader`) — the selected view pill is the
  label; the ✕ tucks into the selector's top-right corner.
- Hands-up / Flip (double-sided POV) moved into the Playback sidebar view (Perspective
  section, gated on canFlip); the old PovBubble is now `!redesign`. ReplayViewer threads
  canFlip/viewLabel/onFlip/revealHands/onRevealHandsChange through the controls bundle.
- Shots: v2-default, v2-playback (desktop); v2-mobile.

---
### Log: 2026-06-30 — Matchup view: history vs the same opponent
- NEW server loader page.tsx `loadMatchesVsOpponent(row, viewerUserId)` — OWNER-ONLY
  (scopes to the viewer's own replays, which they're always entitled to; a teammate
  must not see the uploader's private history). Finds the uploader's recent replays
  (limit 80) whose opponent handle matches the current opponent, EXCLUDES the current
  lobby (that's the SeriesNav series), groups by lobby (Bo3 → one series), newest
  first, cap 6. Skipped when the opponent is anonymous.
- Threaded `opponentHistory` page → ReplayViewer → matchup bundle → MatchupFeature.
- NEW redesign/MatchupHistory.tsx: "History vs <opponent>" — per group a date/time +
  Bo-N score header, a ReplayMatchup card (leader/base + W/L), and per-game W/L chips
  linking to /r/<slug>; single games link the whole card. Reuses ReplayMatchup.
- Verified on r_kg7bke (parkermos vs SolarNomad1052): current Bo3 pills + a prior Bo2
  (0–2) history group.
- NOTE: adds one owner-only 80-row query per replay page load (force-dynamic); fine,
  could cache later.
