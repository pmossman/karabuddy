# First-Class Replays — Implementation Plan

Make a Karabast replay a standalone entity that can exist **without** a deck,
own its own URL and access rules, and be **manually connected to a deck** by the
user (or auto-connected from played composition). Unlocks importing replays from
other sources (KaraBuddy) and cleans up the "every game must belong to a deck"
coupling that exists today.

## The problem: replays are currently owned by decks, not peers of them

A replay cannot exist without a deck today. The coupling is structural:

- **`KarabastGame.deckVersionId`** — required (non-nullable) FK, `onDelete:
  Cascade` from `DeckVersion` (`prisma/schema.prisma`). Same on
  **`KarabastMatch.deckVersionId`**. Delete the deck → the match and all its
  games cascade away.
- **The canonical URL is deck-scoped**:
  `/decks/[deckId]/battle-log/[lobbyId]/[gameId]`. The loader hard-rejects a
  mismatch (`game.deckVersion.branch.deckId !== params.deckId` → 404) in
  `src/routes/decks/[deckId]/battle-log/[lobbyId]/[gameId]/+page.server.ts`.
- **Access control runs entirely through the deck**: `requireMatchAccess(session,
  deckId, lobbyId)` (`src/lib/karabast/server/access.ts`) gates on deck
  ownership / team-folder membership / public deck-link
  (`isMatchPubliclyShareable`).

### Proof of the friction

Seeding the 8 KaraBuddy sample replays
(`scripts/seed-karabuddy-samples.ts`) required **fabricating a 2-card stub deck
per replay** (leader + base only) purely to satisfy the FK and the URL. That
stub is not a real decklist — see next section.

### Why a real deck can't be derived from a replay

A replay only ever reveals cards that entered play or were shown; the other ~40
cards of a 50-card list never appear. The **full composition is unrecoverable**
from the JSON. `deriveGameSummary()` extracts only `myLeader` / `myBase` (+
opponent leader/base) — that is the ceiling of deck signal a replay contains.
So "connect to a deck" must be an explicit user/auto action, never an
inference of the whole list.

## Decisions (to lock before building)

- **Unlinked is a first-class state**, not an error. `deckVersionId = null` means
  "replay exists, not yet attributed to a deck." Mirrors the existing **Needs
  Review** quarantine pattern (`src/lib/karabast/server/reviewStatus.ts`): valid
  row, excluded from deck/team rollups until resolved.
- **Auto-connect stays the default; manual is the override/fallback.** The
  ingest path already tries `resolveDeckFromComposition()` +
  `shouldInheritLobbyDeck()`. Manual connect handles what auto can't guess and
  lets the user correct a wrong guess.
- **Access re-homes onto the replay's own recorder**, not a deck. A replay is
  visible to: its recorder (`profileId → userId`), admins, teams it's scoped to
  (`KarabastMatchTeam`), and the public when the recorder marks it public
  (`KarabastMatch.isPublic` already exists).
- **No stub decks in the real import.** The KaraBuddy pipeline imports replays
  **unlinked**. `scripts/seed-karabuddy-samples.ts`'s stub-deck approach is a
  rendering test scaffold only — it is not the migration shape.

## Milestones

### M1 — Decouple the schema (nullable deck FK)

- `KarabastGame.deckVersionId` → **nullable**; FK `onDelete: Cascade` →
  **`SetNull`**. Same for `KarabastMatch.deckVersionId`.
- Prisma migration; then `npm run db:test:migrate` (swu_test on :5433) so e2e
  doesn't 500. Prod runs `prisma migrate deploy` on deploy automatically.
- Audit every read that assumes a non-null `deckVersion`:
  - the game-page loader join (`branch.deckId` check),
  - deck/team analytics `GROUP BY deckVersionId` (unlinked rows must be
    filtered out, not crash),
  - `KarabastMatch` list queries.
- Add a `reviewStatus`-style predicate `isUnlinked(game)` so every stat query
  excludes unlinked rows uniformly (the quarantine precedent).

**Ship criterion:** an unlinked game can be inserted, read, and is invisible to
all deck/team rollups. No existing linked-game behavior changes.

### M2 — Deck-independent canonical replay URL

- New route **`/replays/[profileId]/[gameId]`** (decided — path-based, no `?u=`),
  reusing the existing `BattleLogPanel` render path. `(profileId, gameId)` is
  already the `KarabastGame` PK and the `gameEventStore` blob key, so the URL
  maps 1:1 onto the natural identity and disambiguates a mirror's two recorders
  by path. The current `/decks/.../battle-log/...` URL stays as a deck-filtered
  *view* that redirects to (or embeds) the canonical one.
- Extract the loader's timeline+catalog build (the `buildGameTimeline` +
  `cardCatalog` block) into a shared helper so both routes share it.

**Ship criterion:** an unlinked replay opens at its own URL with full board /
chat / card art. (All 8 KaraBuddy samples already fold + resolve cleanly per
`scripts/verify-karabuddy-samples.ts`.)

### M3 — Re-home access control onto the replay

- New `requireReplayAccess(session, profileId, gameId, { u })` that gates on:
  recorder ownership (`profile.userId`), admin, match team scope
  (`KarabastMatchTeam`), and `KarabastMatch.isPublic`. No deck required.
- Refactor `requireMatchAccess` to delegate to it for the deck-scoped route so
  there's one access authority.
- Per-replay public toggle in the UI (the `isPublic` column already exists).

**Ship criterion:** access is correct for owner / teammate / public / stranger
on a replay with `deckVersionId = null`.

### M4 — "Connect to a deck" interface

- Mutation `PATCH /api/karabast/games/[gameId]` (endpoint already exists for
  Needs-Review) accepting `{ deckVersionId }`: set the FK on the game (+ its
  match), then rebucket and invalidate — reuse `rebucketLobbyForDeck()` /
  `invalidateForVersion()` from `src/lib/karabast/server/lobbyInheritance.ts`
  and `analyticsCache.ts`, and `invalidateForTeam()` where scoped.
- UI affordance on the replay + in the Battle Log "Unassigned" bucket: a deck
  picker (owner's decks; validate leader/base against the replay's
  `myLeader`/`myBase` and warn on mismatch, don't block).
- Show `resolveDeckFromComposition()`'s best guess pre-selected when confident.

**Ship criterion:** a user connects an unlinked replay to a deck; it disappears
from "Unassigned" and appears in that deck's stats with caches busted.

### M5 — KaraBuddy import pipeline (the payoff)

- Import endpoint / job that accepts a v3 `PersistedTimeline` blob, writes it
  **verbatim** to the private game-event store (`putGameEvents`), and creates an
  **unlinked** `KarabastGame` (+ match) attributed to the matched profile.
- Identity match by shared Google/Discord (README Q4) → land in the right
  swuforge profile. Fall back to a claim flow if no match.
- **One known blob fix required first** (see `scripts/verify-karabuddy-samples.ts`
  finding): KaraBuddy masks the opponent's hand as
  `{cardId:"REPLAYHIDDEN_000", isHidden:false}`. Our renderer draws card backs
  off the `isHidden` boolean (`cardImage.ts:62`), so these 404 as broken art.
  The exporter must set **`isHidden: true`** (and drop the sentinel cardId) so
  hidden cards render as backs. Everything else in the pipe is proven.

**Ship criterion:** a real KaraBuddy replay imports unlinked, renders correctly
(hidden hands as backs), and the user connects it to a deck via M4.

## Existing building blocks to reuse (not rebuild)

- `resolveDeckFromComposition()` — guess deck from played cards (auto-connect).
- `rebucketLobbyForDeck()` / `shouldInheritLobbyDeck()` — re-point a lobby's
  games at a deck + fix stats.
- `invalidateForVersion()` / `invalidateForTeam()` — analytics cache busting.
- `reviewStatus.ts` — the quarantine-predicate pattern for "excluded until
  resolved."
- `KarabastMatch.isPublic` / `KarabastMatchTeam` — per-replay visibility + team
  scope, already deck-independent.
- `gameEventStore.ts` (`putGameEvents`/`getGameEvents`) — deck-independent blob
  storage, keyed by `(profileId, gameId)`.
- `BattleLogPanel` + `buildGameTimeline` — renderer already accepts a
  `PersistedTimeline` directly.

## Decided

- **URL shape:** `/replays/[profileId]/[gameId]` — path-based, matching the
  `KarabastGame` PK / blob-store key. (See M2.)

## Open questions

1. **Migration of existing games:** leave all current games linked (no
   backfill), or add an "Unassigned" bucket only for newly-imported/orphaned
   ones? Leaning: no backfill; unlinked is opt-in via import/disconnect.
2. **Disconnect:** do we allow un-linking an already-attributed replay (set
   `deckVersionId = null`)? Useful for corrections; needs the same rebucket.
3. **Team-scoped unlinked replays:** can a replay be team-visible before it's
   connected to a deck? (`KarabastMatchTeam` allows it structurally.)
4. **v3 vs v4 blobs on import:** run `ensureDerivedEvents()` at import to
   pre-derive credits/force/bounces, or store v3 and derive live? (Ingest
   currently upgrades to v4.)

## Related

- `scripts/seed-karabuddy-samples.ts` — dev seed that renders the 8 sample
  blobs today (via stub decks — test scaffold only).
- `scripts/verify-karabuddy-samples.ts` — offline render/verify of the sample
  blobs (folds, resolves art, checks upgrade attachment).
- `data/karabuddy-swuforge-samples/README.md` — the KaraBuddy dev's notes +
  their 4 handoff questions.
