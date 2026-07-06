# Kickoff: Team Opening Drills (mulligan + resource quiz from teammates' replays)

You're starting a NEW feature for karabuddy. Read CLAUDE.md + CONTEXT.md first
(they auto-load); this doc carries the product idea plus domain facts a prior
session already dug out of forceteki + prod replay payloads, so you don't
re-derive them.

## The idea (Parker's framing)

Teams use karabuddy to improve and help each other test/get better. Build a
**fun way for teammates to try each other's opening-hand decisions and see
where they disagree**:

- You're shown replay "slices" from your teammates' games at the start: the
  opening hand where they decided whether to mulligan, and the post-mulligan
  hand where they picked their first two resources.
- You **go through the motions yourself**: click Mulligan/Keep on the hand,
  then click the two cards you'd resource, and submit.
- Then the reveal: did you match the teammate's actual decision? Show the
  diff, and prompt for a tag/comment to discuss the disagreement.

Core loop = quiz → reveal → discussion. The social payoff is discovering
disagreement inside the team and having a lightweight hook to talk about it.

**Explicit scope decision (Parker, 2026-07-02): the game is NOT running.**
This feature never needs game logic or an engine — it's show-cards + a
Mulligan/Keep choice + picking two cards. "Feeling real" is a UI aspiration
for those two interactions only (karabast-style prompt + card selection), and
even that is soft: bespoke interactions are fine if they suit the quiz flow
better. Don't let "authenticity" drag in engine/simulation complexity.

## Domain facts (verified against forceteki source + real payloads — trust these)

**SWU setup mechanics** (forceteki `server/game/core/gameSteps/phases/SetupPhase.ts`,
`prompts/MulliganPrompt.ts`, `prompts/ResourcePrompt.ts`):
- Sequence: draw 6 → **MulliganPrompt** (all-or-nothing: a mulligan bottoms the
  whole hand, reshuffles, redraws 6 — no partial mulligan in SWU) →
  **ResourcePrompt(2)** (mandatory, exactly 2 cards from hand).
- Both are ALL-PLAYER prompts: **no `isActionPhaseActivePlayer` during setup**;
  `state.phase === 'setup'` until the first `'action'` (that transition is how
  `lib/replayChapters.ts` finds round 1).
- Real prompt copy (reuse for authenticity): mulligan → menuTitle *"Choose
  whether to mulligan or keep your hand"*, buttons **Mulligan** / **Keep**,
  promptTitle *"Mulligan Step"*; resource → *"Select 2 cards to resource"*,
  button **Confirm Resources**, promptTitle *"Resource Step"*.
- Exact game-log lines: `{p} will mulligan` / `{p} will keep their hand` /
  `{p} has resourced 2 cards from hand`.

**Replay payload model:**
- A replay is one recorder's POV. **Only the recorder's own hand/resources are
  unmasked** (opponent's are anonymous placeholders). So each shared replay
  yields exactly ONE drill item: the recorder's own opening. That's fine — the
  drill pool is "my teammates' openings".
- Frames: one `{full}` state + slash-path `{patch}` deltas
  (`lib/replayDecoder.ts` — `decodeReplay`, `applyPatch`). Hand/resource pile
  entries carry `setId {set, number}` + `name` (+ power/hp/type). The `id`
  field is unreliable (sometimes a numeric hash). Card **cost/art come from
  the `cards` catalog table**, not the frame (see how
  `app/(app)/r/[slug]/ResourcingModal.tsx` passes `costOf` from the catalog,
  and how the deck page `DecksTabs` renders card images).
- The two resourced cards = diff the recorder's own `cardPiles.hand` →
  `cardPiles.resources` across setup frames (own piles unmasked).

**Extraction gotchas (learned the hard way — B217/B219):**
- `newMessages` can read cumulative — always match log lines on the
  NEWLY-added delta vs the prior frame (pattern: `isUndoMessage` in
  replayDecoder, `hasNewDecision` in `app/(app)/r/[slug]/actionStops.ts`).
- `actionStops.ts` (B217) already has the exact decision regex
  (`will mulligan|will keep their hand|has resourced|has not resourced`) —
  reusable as-is for locating the decision moments.
- The viewer's `collapseReplay` can drop a "keep" frame (board-static — a keep
  changes no piles). Detect decisions from the LOG, not from frame-count or
  pile diffs alone.
- Early frames may predate the mulligan (hands empty for both players) — the
  recorder's own POV detection retries for this reason.
- `scripts/karabast-sim/make-fixture.mjs` shows how to reconstruct absolute
  states from a payload (slash-path applier) — the same technique slices out
  "hand at mulligan prompt" and "hand at resource prompt".

**Hard constraint — E2EE teams (B170/ADR 0010):** private-mode teams' replay
payloads are ciphertext server-side; the server can NEVER decode them. Any
server-side extraction excludes private teams. v1: plaintext teams only
(client-side bridge-decrypt is a possible later path). Say so explicitly in
the spec.

**Scoping boundary:** the drill pool must be replays **shared to the team**
(`replay_team_shares`, surfaced via `lib/teamSurface.ts`) — the existing
security boundary. Don't invent a new visibility rule.

## Prior art in-repo (read before designing)

- `app/(app)/r/[slug]/actionStops.ts` — B217 decision detection (the regex + delta matching).
- `lib/resourcingAnalysis.ts` + `ResourcingModal.tsx` — B101 first-person resourcing report (adjacent feature; borrow framing, don't duplicate).
- `lib/statsExtract.ts` / `card_events` — per-card facts incl. resourced/drawn with win rates (B101). Great **reveal-screen enrichment**: "the team resources this card 70% of the time".
- `app/(app)/r/[slug]/deck/` + `DecksTabs` — card rendering with art/cost from the catalog.
- Tag system (`lib/tagScope.ts`, replies B78, mentions) — the discussion hook. Strong default: the post-reveal comment is a **team-scoped tag on the source replay anchored at the decision frame** — discussion then shows up in the existing discussion feed/mentions for free, no parallel comment system.
- `lib/swiss.ts` / tournaments tab — precedent for a team-tab feature with its own tables.
- Memory `playable-replay-spike.md` — an in-browser forceteki engine exists (proven, separate spike). **Out of scope here by explicit decision** (see scope note above); listed only so you don't mistake this feature for that one.

## Open design questions — grill Parker on these BEFORE building

1. **Pool + ordering:** which openings become drill items? (recent N team-shared
   games? filter by leader/matchup? exclude your own recordings — presumably yes.)
2. **Anonymity:** hide whose opening it is (and the matchup?) until after you
   answer? Showing leader/base + opponent matchup is probably necessary context
   for a meaningful decision — confirm what's visible pre-submit.
3. **The reveal:** what exactly do you learn? (their choice + resource picks,
   the diff, and then: game outcome? what they drew next few turns? card_events
   stats? how OTHER teammates answered the same item?)
4. **Aggregation:** is there a team view of disagreement ("we split 3–2 on
   mulliganing this hand") — and does that need answers stored per (item, user)?
   → almost certainly a new table (drill responses); design additive
   (expand/contract rule).
5. **Discussion:** confirm the reuse-tags default (vs a bespoke comment thread
   on the drill item).
6. **Entry point + name:** team-page tab? dashboard card ("3 new openings to
   review")? What's it called?
6b. **How "real" should the two interactions feel?** Karabast-mimicking prompt
   chrome (their exact button copy/layout) vs a bespoke quiz UI tuned for
   speed/fun. Per the scope note this is a taste call, not a requirement —
   `/prototype` a couple of variants if unclear.
7. **Repeatability/notifications:** do new shared replays feed a queue? Any
   mention/Discord ping when a teammate disagrees with you?

## Suggested path

1. Read the prior-art files above; skim a real payload's setup frames
   (`scripts/karabast-sim/fixture.json` is an anonymized real game — frames 0-N
   include the full setup sequence).
2. Grill Parker on the questions (consider `/grill-with-docs`), then write the
   spec as a BACKLOG entry — **verify the next free B-id in BACKLOG.md first**
   (B221 as of 2026-07-02, but it drifts; CLAUDE.md's note lags too).
3. Tracer bullet first: ONE drill item end-to-end (extract one teammate
   opening from a real shared replay → quiz UI → submit → reveal diff → tag
   posted) before any aggregate/table/queue work. `/prototype` may be worth it
   for the quiz-UI feel (it's the fun-factor make-or-break).
4. Extraction: decide server-side persisted facts (statsExtract pattern —
   bounded, at upload + backfill) vs on-the-fly decode; either way it must not
   fail uploads (persistStatsSafe posture).

Chrome rules apply (design system: `karabuddyTokens`, `<LedToggle>` for
toggles, themed MUI, no native form controls — CI enforces). Migrations:
expand/contract, journal monotonicity. Tests: unit for the extraction (pure),
api for the routes, e2e for the quiz flow.

---

## UI feedback from Parker (2026-07-03, via the viewer-redesign session)

Mobile screenshot (~430px) of the quiz mid-mulligan on the team page showed:

1. **The seat line is clipped/overlapped by the hand strip** — "Your seat · a
   teammate's opponent — supreme leader snoke…" renders half-hidden behind the
   hand-card row. The leaders/bases "vs" row + seat text + hand strip overlap
   instead of stacking; hand cards also overflow their container edge-to-edge
   while everything else is padded.
2. FYI: the sitewide footer sat directly under the Mulligan/Keep buttons.
   That's fixed globally (footer is now in-flow below the fold — see
   `app/_components/Footer.tsx` + AppShell `main` min-height on main); no
   openings-side action needed, but pull/rebase before relying on it.

(Reported to the redesign session; it deliberately did NOT touch this worktree
since your work was in flight. Fix the stacking here with the feature.)
