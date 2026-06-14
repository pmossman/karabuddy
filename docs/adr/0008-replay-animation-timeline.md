# ADR 0008 — A precomputed replay timeline as the animation + playback foundation

Status: **accepted (incremental migration in progress)** · 2026-06-14

## Context

The replay viewer animates each frame transition (leader deploys, card plays, attacks,
resourcing, …) and autoplay/clips pace themselves so each animation finishes before advancing.
Three subsystems each **independently re-derive "what happens this frame"** and are allowed to
disagree:

1. **`frameLog` + `frameAnimationPlan` (the planner)** — decide *what to animate* from the board
   diff + log, producing geometry-laden `Intent`s.
2. **`frameDwell`** — decides *how long autoplay waits* on a frame, via its own classifier.
3. **`FrameAnimator` executors** — decide *how it renders*: measure DOM rects, clone, hide live
   elements, run Web Animations, and **hard-cancel everything on the next frame change**.

Every animation bug we've shipped lives in a seam between these:

- **B141** — the resourcing dwell didn't know a deploy was on the frame → cut.
- **B146** — the collapse stripped a deploy's log line; the *log-based* dwell fell through to the
  300ms tick while the *board-based* planner ran the full ~1710ms deploy → autoplay cut it.
- The black-bar / post-deploy-bounce bugs — the clone/hide lifecycle was hand-rolled per executor.

The root problem: **timing is a heuristic estimate computed separately from the animations, and
interruption (cancel-on-frame-change) is the same mechanism as autoplay pacing** — so any
disagreement, or any premature timer advance, cuts an animation. We've been patching seams.

## Decision

Introduce **one precomputed, geometry-free semantic timeline** as the single source of truth for
*what animates and for how long*, then a thin renderer that maps it to the DOM. Three layers:

### A. Timeline — pure, precomputed at load, no DOM

`buildTimeline(frames) → Beat[]`, where:

```ts
type AnimKind = 'leaderDeploy' | 'play' | 'ambush' | 'upgrade' | 'event' | 'resource' | 'attack' | …
interface AnimSpec { kind: AnimKind; uuid?: string; /* semantic, geometry-free */ }
interface Beat { frameIndex: number; anims: AnimSpec[]; durationMs: number; actor: string | null }
```

This does the **one** classification currently split three ways (board diff ∪ log). `durationMs`
(`max(anim durations) + read buffer`, or the tick) lives here, so the dwell, the clip progress-bar
segments, scrub targets, and chapter markers all read the **same** structure — **the divergence
class disappears by construction.** It is pure, so a `gamestate fixture → expected beats` test makes
B141/B146 un-regressable. (Eventually built from the *full* decoded frames so a lossy collapse can
never strip a signal again — see Migration.)

### B. Player — drives time, owns interruption

Two **explicit, separate** advance modes (this split is the core fix):

- **Time-driven (Play / autoplay):** advance after `beat.durationMs` (scaled by speed). Because the
  duration and the animations come from the *same beat*, the advance is guaranteed ≥ the animation
  length — **autoplay never cancels mid-animation.**
- **Input-driven (arrow keys / scrub / jump):** advance *immediately* and **cut** the current beat.
  Interruption is a first-class capability, not a side effect of the timer. Held / mashed arrows
  arriving faster than a threshold drop into **scrub mode** — snap through intermediate beats with
  `animate:false`, only animating the frame you land on (no animation backlog).

Today these are conflated (cancel-on-frame-change serves both), which is exactly why a premature
autoplay tick cuts an animation. Separating them resolves the bug *and* keeps fast arrow-key
navigation crisp.

### C. Renderer — the only DOM layer

Maps a beat's `AnimSpec`s to visuals through three clean, mockable seams:

- **Card positions →** a `BoardGeometry` interface (`rectOf(uuid)`, `resourcePile(side)`), backed by
  `data-card-uuid` but abstracted. The "measure the *settled* layout" concern (the B141 pre-measure
  hack) becomes one property of this layer, not a per-animation special case.
- **Clones + hiding →** a single `Stage` manager: primitives *declare* "clone uuid A→B with these
  keyframes; suppress the live element until tᵢ." The Stage owns clone lifecycle, suppression/reveal,
  cancellation, and cleanup uniformly. Every clone-left-behind / black-bar bug was this logic being
  hand-rolled per executor.
- **Animation kinds →** a small **primitive vocabulary** (rise, flip, tuck, lunge, fade, slam, shake,
  vignette) composed per kind (`leaderDeploy = rise + hold + flip + slam + shake`; `pilotDeploy =
  rise + flip + descend-tuck + shake`). Kinds *share* primitives instead of each being bespoke WAAPI.

The renderer exposes `renderBeat(beat, { animate })` and `cut()` so the Player can settle-to-end-state
instantly at any time (the terminal state is just the frame's static render).

### Adding a new animation becomes

1. a detection rule in **A** (board/log → a new `AnimSpec` kind + duration), and
2. a primitive composition in **C**.

Both localized, data-driven, unit-tested — no touching three classifiers and hoping they agree.

## Migration (incremental; each step ships green)

1. **Timeline + `frameDwell` consumes it.** `buildTimeline` becomes the single classifier; `frameDwell`
   is a thin consumer (`durationMs` + the player-handoff pause). No visual change — it collapses the
   *timing* divergence (would have prevented B141 and B146) and is the most testable piece.
   **← this ADR's accompanying change (B147).**
2. **`BoardGeometry` + `Stage` + primitives.** Refactor the planner's executors to consume the beat's
   `AnimSpec`s and render via the geometry/Stage seams. Kills the clone/hide bug class.
   - **2a — `BoardGeometry`.** Behavior-preserving extraction of the inline `measure()` into
     `boardGeometry.ts`. **Done.**
   - **2b — `Stage` + primitive vocabulary; migrate `runIntent` kind-by-kind.** `animPrimitives.ts`
     (`slide`/`enterFade`/`exitFade`/`flip`/`playFlip`/`lunge`/`targetHold`/`tracer`/`flash` +
     the `stagePresent` composite behind the rise→present→land plays). Every staged kind
     (`resourceStage`, `eventStage`, `upgradeStage`, `leaderDeploy`, `pilotDeploy`) ported
     byte-identically, each visually verified before the next. **Done** (the `leaderFlip`
     crossfade stays inline — it's not a stage-present composite). Two real bugs surfaced + fixed
     while vetting: opponent events never flipped face-up (discard renders no measurable rect →
     derive `faceUp` from `setId`); a pilot/upgrade host showed its buffed stats a full deploy
     early (`holdHostStats` holds the pre-attach render until the upgrade lands).
   - **2d — retire the planner's independent classifiers (one source per signal).** *Done for the
     signals that can drift.* The geometry-focused planner can't re-classify and resolve geometry in
     one pass, so the shared geometry-free classifiers live in `frameLog`, consumed by BOTH the
     renderer (via the planner) and the dwell (`buildTimeline`):
     - **Attacks** — `frameLog.frameAttacks` (log + isAttacker flag + exhaust/damage fallback,
       deduped). The planner renders the resolved list it's handed; the timeline budgets exactly that
       set. Eliminates the B141/B146 drift class.
     - **Play kind** — `frameLog.playKindOf` (discard=event / arena+parent=upgrade / arena=unit), the
       one rule behind `classifyStagedPlays`, `unitPlayUuids`, and the planner's staged-play branch.
     Deliberately NOT folded (they are render-layer, not semantic — see the consequences below):
     hidden-hand pairing (keys off synthetic `replay-hidden-*` DOM uuids absent from frame state),
     move-vs-reflow (`dist > MOVE_THRESHOLD`), and enter/exit (measured card presence). The thin
     zone-transition checks that remain (deploy = leader `base→arena`; resource = `hand→resources`)
     are already derived on both sides from the same `frameLog` extractors, so there's no independent
     classifier left to drift.
3. **2e — (Optional) event-driven / arrow-cut player.** Have the renderer emit "beat complete" as a
   belt-and-suspenders gate, and make arrow-key input cut the in-flight beat. Not required for
   correctness once the timeline guarantees duration ≥ animation. *Deferred.*

## Consequences

- **+** One source of truth; the dwell/planner/progress-bar can't drift. Bugs become pure unit tests.
- **+** Extensible: new animations are additive + local. Interruption + fast nav are first-class.
- **+** The timeline is a backbone for more than animation (scrub segments, chapter markers,
  jump-to-next-deploy, "what happened" tooltips, and potentially the stats `card_events` diff engine).
- **−** Step 2 is a real refactor of the executors; the visual tuning (easings/offsets/vignette/shake)
  must be preserved in the primitive vocabulary — migrate kind-by-kind against the current output.
- POV/double-sided flips stay a *render-layer* concern (geometry), cleanly separated from the
  POV-agnostic semantic timeline (card uuids + zones).

## References

- `app/(app)/r/[slug]/replayTimeline.ts` (Layer A), `frameDwell.ts` (step-1 consumer),
  `frameAnimationPlan.ts` + `FrameAnimator.tsx` (today's planner/renderer, step-2 targets),
  `frameLog.ts` (semantic extractors), `playback.ts` (the dwell stepper → future Player).
- Bugs that motivated this: B141 (resourcing cut), B146 (deploy cut / log-vs-board), the B141
  black-bar/bounce clone-lifecycle fixes.
