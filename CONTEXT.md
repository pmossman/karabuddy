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
