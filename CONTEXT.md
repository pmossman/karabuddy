# Domain glossary

The shared language of karabuddy. Terms an agent needs before touching the
code. See [CLAUDE.md](./CLAUDE.md) for architecture and [docs/adr/](./docs/adr/)
for the decisions behind the model.

## Core objects

- **Replay** — one captured karabast.net match. Stored as a `replays` row +
  a payload blob on Vercel Blob (`payloadBlobUrl`). Identified by a `slug`
  (`/r/[slug]`). Carries derived metadata: `players`, `winners`,
  `ownerPlayerId`, `match` (format/cardPool/Bo*), `decks`, `displayName`,
  `labels`.
- **Frame** — one gamestate snapshot within a replay. The viewer steps through
  frames. `?f=N` in the viewer URL is **1-based** (human-friendly sharing);
  internally frames are 0-based. Tags pin to a `frameIndex`.
- **Payload** — the raw recorded data (gamestates + lobby snapshot + tags) the
  extension uploads. Decoded by `lib/replayDecoder.ts`.
- **Tag** — a timestamped comment pinned to a frame of a replay (`tags` row).
  Created in-game (extension) or in the viewer (web). May carry structured
  **mentions** and a **team scope**.
- **Clip (B136)** — a saved `[start, end]` frame range of a replay (`clips`
  row), bounds stored in ORIGINAL frame space (survive re-upload). Any viewer
  can create one from the viewer's trim builder; it gets a shareable link to a
  dedicated auto-playing **reel** (`/c/<slug>`) that ends on a summary card
  (matchup, replay/share, "watch full replay"). Link-public, anonymized for
  non-identity-entitled viewers like the parent replay. Listed in the matchup
  info (sidebar + mobile ⓘ panel). Discord/Twitter unfurl with a static
  moment-card thumbnail (`og-image`); animated embeds are deferred.
- **Leader / base** — the two signature cards defining a SWU deck. Always
  captured for both players; karabast masks the opponent's full decklist, so
  for the opponent only leader + base are known (the rest is recovered as
  **seen cards** — every card observed in play across frames).

## Identity & accounts

- **Install token** — opaque `kbx_<uuid>` minted per extension install, stored
  in `chrome.storage.local`. Attributes anonymous uploads/tags. Sent to the
  server as the `X-Install-Token` header on `/api/me/*` when there's no
  session.
- **Claim** — linking an install token to a signed-in account
  (`extension_tokens` row). On sign-in the bridge auto-claims, merging the
  anonymous capture history into the account. One user → many tokens (one per
  browser/device).
- **Bridge** — the extension content script running on karabuddy origins
  (`karabuddy-bridge.js` / `content.js`) that exposes the install token to the
  page and performs same-origin claim fetches.

## Teams & sharing

- **Team** — a group of accounts (`teams` + `team_members`, owner/member
  roles) joined via an **invite code** (`team_invites`). The unit of shared
  review.
- **Share** — an explicit `replay_team_shares` row making a replay visible to a
  team. **A replay reaches a team ONLY via a share** — never merely because a
  member tagged it. The replay owner shares from the viewer; the extension
  shares on upload via its **armed** teams.
- **Armed teams** — the teams the extension's floating bubble is currently set
  to share into. On upload they become the replay's shares.
- **Surfacing** — whether a replay appears in a team's view/discussion feed.
  Driven by shares (`lib/teamSurface.ts`).

## Comment scoping (B71/B73)

- **Scope** — the subset of a replay's shared teams a given tag is visible to
  (`tag_team_scope` join table). **Empty scope = personal** (author-only).
  Bounded server-side: `audience ⊆ replay shares ∩ author memberships`
  (`lib/tagScope.resolveTagScope` — the security boundary).
- **Owner visibility (B131)** — the replay's OWNER (claimed account or
  install token) sees EVERY tag on their own replay, scope notwithstanding:
  a comment on someone else's replay is feedback addressed to them. The
  motivating case: an anonymous (signed-out) reviewer's comments are always
  personal-scoped and were invisible to the very person they reviewed.
  Applied in the tags GET + share-token routes via
  `tagVisibleToViewer(..., { isReplayOwner })`.
- **Public replay (B133)** — the owner published the replay
  (`replays.public_at`, Share-popover toggle). It lists on the 🌐 Public tab
  (/replays, signed-out included) + the signed-out home showcase, and ALL its
  tag comments become readable by anyone: non-identity-entitled viewers get
  the **redacted** wire form (`lib/publicTags.ts` — authors aliased to
  Player1/Player2/Reviewer N, @mentions stripped from text, no
  userId/authorToken/mentions fields). Entitled viewers keep their normal
  reads. Unlisted (null) remains the default; unpublishing locks strangers
  out again.
- **Narrowing rule** — how a draft's scope is computed from @-mentions
  (`lib/commentScope.scopeFromMentions`): 0 mentions → all armed teams
  (broadcast); ≥1 mention → union of mentioned people's teams ∩ armed. Shared
  byte-for-byte between web and extension (`extension/replays/00-comment-scope.js`,
  parity-tested). A UX convenience — the server re-clamps.
- **Reply / thread (B78)** — a tag with `parentTagId` set, threaded one level
  under a top-level tag (Google-Docs-style). A reply inherits the parent's
  frame + scope and auto-@mentions the parent author; replies can't be replied
  to. Its audience ⊆ the parent's, so it never escapes the thread.
- **Mention** — a structured `@user` / `@team:slug` reference inside a tag
  (`mentions` jsonb: `{ userIds, teamSlugs }`). Drives narrowing + the
  `/mentions` inbox. The displayed `@handle` is cosmetic; the structured ids
  are authoritative.

## Kill-switch (B72)

- **Status / tier** — `GET /api/extension/status` returns `ok | nag | block`
  per the live policy (`lib/extensionPolicy.ts`). `nag` = update-available but
  fully working; `block` = break-glass for a dangerous version, and even then
  keeps buffering recordings locally (a stopped recording is a permanently lost
  game).

## Tournaments (B124)

- **Tournament** — an async, internal team event (`tournaments` row, belongs to
  one team). Swiss pairings + Bo3 matches in v1. Lifecycle:
  `setup` (registration) → `active` (rounds) → `complete`. Standings are
  derived on read (`lib/swiss.ts`), never stored.
- **Organizer** — the tournament's creator or any team owner. Can adjust
  everything: settings, guests, decklists, results, drops, round pacing.
- **Entrant** — a participant (`tournament_entrants`). `userId` is OPTIONAL:
  null = a **guest** who isn't a karabuddy user, managed fully manually by the
  organizer (name, decklist, results). All automation (self-registration,
  self-reporting, replay suggestions) applies only to account-linked entrants.
- **Decklist snapshot** — imported server-side from a deck-site link
  (`lib/deckImport.ts` via `/api/swudbdeck`) and FROZEN on the entrant row at
  registration. Per-tournament visibility: `open` | `hidden-until-start` |
  `private` (enforced in the GET serializer; the deck NAME hides with the list).
- **Round / match / bye** — `tournament_rounds` (with a stored `pairingSeed`
  for reproducibility; `createdAt` doubles as the replay-detection lower bound)
  and `tournament_matches` (per-game results in `games` jsonb, each
  `{winner, replaySlug?}`). A bye is a match row with `entrant2Id` null, stored
  pre-confirmed 2-0. Match status: `pending` → `reported` (paired player) →
  `confirmed` (organizer lock; organizer reports land confirmed directly).
- **Suggestion** — a replay-derived score for a pending linked-vs-linked match
  (`lib/tournamentResults.ts`): replays since the round was paired, uploaded by
  or participant-linked to the paired entrants, grouped by `match.lobbyId`.
  Computed on read, never stored, and NEVER auto-committed — a paired player or
  the organizer confirms it through the normal report endpoint. A
  single-recorder replay infers the opponent from pairing context (unverified —
  that's why confirmation is mandatory).
- **Tournament invite (B126)** — a shareable capability (`tournaments.invite_code`,
  organizer-minted lazily) behind `/tournaments/join?code=…`, a PUBLIC page:
  signed-out guests self-register with a name + optional decklist link; a
  signed-in non-member registers account-linked. Each guest entrant carries a
  single-use **claim token** (`tournament_entrants.claim_token`, organizer can
  copy the guest's personal claim link): claiming with a signed-in account links
  the entry (userId + account name). Decklists are never shown on the public page.
- **Entrant-scoped access (B127)** — tournament access is DECOUPLED from team
  membership: a linked entrant who isn't a team member (came in via the invite
  link) can view THAT tournament's page, see pairings/standings + decks per the
  visibility setting, report their own matches, and manage their own
  registration — and nothing else team-side (`getTournamentAccess` in
  lib/tournamentAccess: `canView = member OR linked entrant`). Claiming never
  joins the team; team membership stays owner-controlled via normal team
  invites. Organizer powers always require membership.
- **Both hands face up (B128)** — double-sided replays (B112) show COMPLETE
  information on one stable board: the other recording's unmasked hand +
  face-down resources are merged into the shown timeline per frame
  (`app/(app)/r/[slug]/revealHands.ts`; joined via the board-signature
  `mapFrameIndex` — hidden-zone card uuids are randomized per viewer, so a
  uuid join is impossible). Default ON; toggled from a split capsule next to
  Jump-to-moment (only when `canFlip`) whose other half is the **manual Flip**
  (relocated from the playback pill/bubble): a snappy dip-to-black masking the
  board mirroring while the seat swaps. There is deliberately NO auto board
  flipping — an earlier hotseat auto-flip prototype fought SWU's alternating
  actions (flip loops, interrupted choreography) and was replaced by this.
  GameCard treats an opponent-hand card WITH a setId as revealed (face-up,
  hover preview).
- **Series hop (B129)** — replays sharing a `match.lobbyId` are one Bo3
  series. The viewer shows hop pills ("Game 1 / Game 2 / …", play order
  among RECORDED games) under the title plus a "— Game N" auto-title
  suffix, for identity-entitled viewers only (`canViewReplayIdentities`) —
  an anonymous share-link visitor is never handed the sibling slugs. The
  replay browser's series groups (B116) label each game with a Game-N chip.
  Curated samples (B107) now anonymize **by entitlement** instead of
  unconditionally: the public still sees "Player 1 vs Player 2", but the
  uploader/teammates see their own featured replay normally.
- **Review queue (B135)** — the uploader flags a replay's share to a team
  for review (`replay_team_shares.review_requested_at`, set from the
  viewer's Share menu per shared team). It surfaces in that team's
  **Review queue** tab. Requesting is owner-only and the replay must
  already be shared with the team (the flag lives on the share row);
  **any team member** can "Mark reviewed" to clear it (collaborative). API:
  `POST /api/replays/[slug]/review {teamSlug, requested}` +
  `GET /api/teams/[slug]/review-queue`. Never automatic.
- **Card-play choreography (B134)** — the FrameAnimator (B110 pure
  planner → executor) gained dramatic "staged" animations for the big
  plays, each detected from the log + zone transitions: an EVENT flies out
  of the hand, presents above the board, then drops to discard — its EFFECT
  (defeats, bolts, board shifts) held until the card presents; an UPGRADE
  presents above its unit then tucks under it; RESOURCING grows the card(s)
  side by side, holds for a read, flips face-down, drops into the pile (own
  face-up, opponent face-down — hands-up reveal animates both the same); a
  leader DEPLOY raises off the table, holds under a spotlight vignette,
  flips to its unit side, and slams down with a board shake. Pure intents
  (`leaderDeploy`/`eventStage`/`upgradeStage`/`resourceStage` + delays) in
  `frameAnimationPlan`; the executor clones into the overlay. Action-step /
  autoplay dwell per-frame on these (`frameAnimMs`) so they aren't cut off,
  and a unit played-then-attacking (ambush) holds the play before the lunge.
  Cardbacks render `contain` (the default `/card-back.png` is square, so
  `cover` cropped the logo).
- **Unified playback foundation (B138)** — the replay viewer, the clip reel,
  and the clip builder preview all drive their boards through ONE foundation so
  they can't diverge: `playback.ts` (`resolveConnectedPlayer` — POV from the
  decoded payload's `meta.localPlayerId`; `usePlaybackBoard` — POV + frame push
  with forward-step animate / scrub-snap; `createDwellStepper` — the dwell-paced
  stepping engine; `PLAYBACK_SPEEDS` — literal 0.5×/1×/2× multipliers, default
  1×), and `animationTiming.ts` (the single source for every choreography
  duration + the `dwellFor(total)` = `total + READ_BUFFER_MS` rule that
  `computeFrameDwells` uses, so a frame always outlasts its animation at 1×).
  Speed is one multiplier scaling BOTH the dwell (stepper) AND the animations
  (FrameAnimator sets each Web Animation's `playbackRate`), so beats are never
  cut off at any speed. POV anonymization derives id→label from the FRAMES
  (`anonByIdFromFrames`) — the stored players summary has no ids.
- **Base damage shake (B139)** — a base that takes damage jiggles, amplitude ∝
  damage dealt (`min(18, dealt·1.5+0.5)` px). Tracked via a base-uuid→damage ref
  across frames; only on forward playback. Animates an overlay CLONE (real base
  hidden underneath) — transforming the live base in the board DOM didn't move
  it.

## Opening drills (B221)

- **Opening** — the recorder's setup-phase decision slice of one replay: the
  dealt hand at the mulligan prompt, the post-mulligan hand, and the two cards
  resourced. Exactly one opening per replay (only the recorder's side is
  unmasked). A replay with no captured setup (mid-game recording start,
  encrypted payload) has no opening.
- **Opening drill** — the quiz loop over teammates' openings: re-make the two
  decisions yourself (Mulligan/Keep, then pick 2 resources), submit, get the
  reveal. The pool is derived from replays shared to the team; your own
  recordings are excluded. Lives on the team page's **Openings** tab.
- **Drill response** — one member's answer to an opening (mulligan choice +
  resource picks). Keyed by replay + responder — NOT by team; what a viewer
  sees of others' responses is scoped at read time (your teammates'; the
  replay owner sees all, as with tags). Immutable once submitted.
- **Reveal** — the post-submit screen: the recorded decision vs yours, whose
  game it was, the team's response distribution, and a jump into the viewer
  at the decision frame.
- **Consensus / split** — whether a team's responses to an opening agree or
  disagree (with each other and with the recorded choice). Badged on the
  drill list; "everyone answered differently from the recorder" is the
  headline signal for the uploader.
- **Coaching mode** — filtering the drill pool to one teammate's openings;
  doing so reveals identity pre-submit (the anonymous default applies to the
  mixed pool).

## Canonical UI components (build-here registry)

When building a surface that does one of these jobs, **use the canonical component — don't re-roll it.** This list is the defense against conceptual duplication (the same job done by divergent code in different files — the failure that let the deck viewer fork into three implementations). It complements the audit method: classify components by concept, invert concept→components, and anything with >1 implementation is a re-fork to reconcile.

| Concept | Canonical | Notes |
| --- | --- | --- |
| Modal / dialog overlay | `<Modal>` (`app/_components/Modal.tsx`) | portal + backdrop + Esc + scroll-lock |
| Confirm | `useConfirm()` / `<ConfirmDialog>` (`Confirm.tsx`) | rides `<Modal>` |
| Popover / responsive menu | `<Popover>`, `<ResponsiveMenu>` | desktop popover ↔ mobile sheet |
| Dropdown `<select>` | `<Select>` | **CI-guarded** (canonical-components.test.ts) |
| Single-select button group | `<Segmented>` | track/pill variants |
| On/off + multi toggle | `<LedToggle>` | ADR-0006, **CI-guarded** (no-native-form-controls.test.ts) |
| Scope / nav tabs | `<ScopeTabs>` | desktop strip ↔ mobile picker |
| Per-player deck tabs | `<DecksTabs>` | viewer modal + grid quick-view + deck page |
| Sortable table | `useSortable` + `<SortHeader>` | |
| Filter toolbar | `<FilterChip>` / `<Field>` (`FilterToolbar.tsx`) | |
| Leader+base thumbnail | `<LeaderBasePair>` | mini matchup thumb (NOT the live-board `LeaderBaseCard`); `orientation="overlap"` (leader front, base peeking behind) is the canonical MATCHUP treatment |
| Leader/base dropdown (art options) | `<LeaderSelect>` | name-only dropdowns don't scan — options carry card-art thumbs; native `<select>` can't render images |
| Recent filter-sets (restore chips) | `useFilterMemory` + `<FilterMemoryChips>` (`filterMemory.tsx`) | per-device localStorage; record at the MEANINGFUL moment (session start / search), not per keystroke |
| Base functional identity | `lib/baseIdentity.resolveBaseIdentities` | which bases are ACTUALLY the same base: vanilla → aspect, force pairs/reprints → shared ability-text hash (`cards.base_ability_hash`), unique → themselves. Any base filter/selector MUST key on this, never raw names |
| Matchup VS row | `<MatchupRow>` | replay/clip card header |
| Deck card list | `<DeckBlock>` / `<DecksTabs>` | **retiring `DeckGrid`** — migrate, don't extend |
| Status (error/loading/empty/muted) | `StatusUi.tsx` | |
| Buttons | `glowButtonStyle` (primary) / `buttonStyles` (ghost/danger) | |

**Greppable divergences are CI-enforced** (`test/unit/canonical-components.test.ts` + `no-native-form-controls.test.ts`); each guard carries an allowlist that is the migration backlog for that concept. Non-greppable concepts (deck rendering, segmented controls, activity rows) rely on this registry + a periodic concept-axis audit. **Known not-yet-unified (migrate onto the canonical, don't add new copies):** `DeckGrid`→`DeckBlock`; team/tournament form `<select>`s→`<Select>`; bespoke segmented controls (ReviewQueue/SeriesNav/JumpToMenu/StepModeOverlay/TimelineGroups)→`<Segmented>`; feed rows (TeamDiscussion/HomeTeamActivity/MentionsList/HomeReviewRequests)→a shared `<ActivityRow>`.
