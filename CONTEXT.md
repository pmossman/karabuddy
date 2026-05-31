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
