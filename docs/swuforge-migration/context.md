# Context — verified technical facts

The knowledge base for the migration. Everything here is verified against real
data / code unless marked *(unconfirmed)*. Update as facts firm up.

## The two apps

- **karabuddy** (this repo) — replay capture + review + teams + stats. Replay-first.
- **swuforge** (Andy's, swuforge.com) — SWU deckbuilder. **Deck-first**: replays
  ("battle logs") are tied closely to a decklist. Auth: Google + Discord (same as
  karabuddy → shared-identity bridge). Object model (from Andy's plan): `Deck` →
  `DeckVersion` (branches), team folders, `KarabastMatch`/`KarabastGame` (replays),
  per-deck stats. Deck builder is `/workshop`; card search `/search`.

## Replay → replay conversion (PROVEN)

Both apps derive from **karabast/forceteki** gamestate, so conversion is a field
normalization, not a translation. Converter: `scripts/prototype-replay-to-swuforge.ts`.

- karabuddy `.karareplay` (events: `{full}` seed + `{patch}` deltas, slash-paths)
  → swuforge **`PersistedTimeline` v2** (`base` + objectDiff `steps`) or **v3**
  (+`chat`). Patch merge semantics are identical (objects merge, arrays/scalars
  replace); only the encoding differs.
- **No structural transform.** Card fields are near-1:1 renames (`setId{set,number}`
  → `cardId:"SET_NNN"`, card `id` → `karabastId`). Upgrades are already separate
  arena cards with `parentCardId = host.uuid` on both sides — carry through.
- **Round-trip verified**: fold `base+steps` with swuforge's documented
  `applyPatch` → byte-identical frames. **800/800 random replays** pass.
- **v3 chat**: karabast `newMessages` (per-frame delta of `{date, message:[…]}`)
  → swuforge `chat:[{ts, tokens[]}]`, byte-identical to Andy's example.
- **Privacy**: karabast masks opponents' hidden cards, so only face-up plays carry
  identity. The converter scrubs the opponent handle → "Opponent"; an `anon` mode
  scrubs both → "Recorder"/"Opponent" (used for the sample pack of others' games).
- Size: ~7KB/game gzipped (matches Andy's ~15KB estimate).

### Known converter fix (from Andy's verify) — TODO
karabuddy's decoder replaces the opponent's hidden hand cards with a sentinel
`{cardId:"REPLAYHIDDEN_000", isHidden:false}` (`lib/replayDecoder.stripHiddenHandCards`).
Swuforge draws card backs off `isHidden`, so these 404 as broken art. **The
exporter must emit `isHidden: true` and drop the sentinel cardId** for masked
cards. Small fix in the converter's `normCard` (detect REPLAYHIDDEN → isHidden:true,
cardId:null). Everything else in the pipe is proven.

## What karabuddy stores about DECKS (the migration fuel)

`replays.decks` (JSONB), captured once from karabast **lobbyState** at game start
(B42), per playerId: `{ username, name, leader:{name,set,number}, base:{…},
deck:[{id:"SET_NNN",count,cost,internalName}], sideboard:[…] }`.

- **Recorder's OWN POV: the FULL 50-card maindeck + full sideboard.** Verified:
  most are `50+10`; some `50+0` (no sideboard captured); some partial `30+12`
  (nextSet/pre-release fragments). Opponent's list is `null` (karabast masks it —
  leader/base only).
- **This is the migration's superpower:** Andy's own replays can't yield a real
  deck (only ~10 of 50 cards ever appear on-board). karabuddy *has the whole list*,
  so we can auto-create complete swuforge decks + link the replays.
- **Deck derivation already prototyped**: `scripts/prototype-user-deck-export.ts`
  clusters a user's replays into deduped archetype decks (leader identity + base
  functional identity, `lib/baseIdentity`), latest-complete list per archetype,
  ≥50-card completeness guard. Real run: one heavy user's 416 replays → 20 decks.
  Reuses `lib/sideboardGuides` (`buildArchetypes`) + `lib/cards`.
- **Deck SOURCE is NOT stored.** We keep name/leader/base/cards/sideboard only.
  karabast tracks provenance (`DeckSource` enum incl. SWUDB/SWUBase/**SWUForge**,
  + `deckLink`/`deckID`, from the import URL) but the extension strips it at
  capture. Capturing it = a small additive extension change, *future recordings
  only* — and *(unconfirmed)* whether the lobbyState broadcast even carries it.

## "Versions" — detectable, the value-add

Within one archetype, karabuddy can diff the full decklists across a team's games
over time and cluster into **versions** (e.g. "v1 → cut 2x A, added 3x B → v2").
swuforge models this as `DeckVersion`/branches, so migrated decks can arrive with
their real version history + per-version win-rate. Not yet built; the data (dated
full lists per game) is all present.

## Andy's "first-class replays" plan (his side) — enables the import

Full copy: `andy-first-class-replays-plan.md`. Summary: today a swuforge replay
*must* belong to a deck. He's decoupling them so a replay can exist **unlinked**:

- **M1** nullable deck FK (`deckVersionId` → nullable, cascade→SetNull); unlinked
  is a valid "quarantine" state, excluded from deck/team rollups.
- **M2** deck-independent URL `/replays/[profileId]/[gameId]`.
- **M3** access re-homed onto the replay (recorder / admin / team / public).
- **M4** **"Connect to a deck"** — manual picker + `resolveDeckFromComposition()`
  auto-guess (validates leader/base vs the replay's, warns on mismatch).
- **M5** **karabuddy import pipeline** — accept a v3 `PersistedTimeline`, store
  verbatim, create an *unlinked* game attributed to the matched profile (identity
  via shared Google/Discord). The `isHidden` fix above is the one prerequisite.

Implication for our migration: replays that DO have a complete karabuddy decklist
→ we create the deck + connect (better than his auto-guess). Replays that DON'T
(fragments) → import **unlinked**, user connects later. Both paths exist.

## Reciprocal (noted, not in scope for v1 migration)

Watch a **swuforge** replay in the **karabuddy** viewer — both are the same
`PersistedTimeline`/frame model, so the karabuddy viewer could render swuforge's
blobs. Lets migrated users keep both apps' benefits. Future.

## Key files / pointers

- Converter: `scripts/prototype-replay-to-swuforge.ts` (+ `--pack`, `--batch`).
- Deck derivation: `scripts/prototype-user-deck-export.ts`.
- Reuse: `lib/sideboardGuides.ts`, `lib/baseIdentity.ts`, `lib/cards.ts`,
  `lib/replayDecoder.ts`, `lib/userResolution.ts` (export scope = userId + claimed
  install tokens).
- Sample pack sent to Andy: `~/Downloads/karabuddy-swuforge-samples.zip`.
- Andy's handoff spec: `~/Downloads/swu-replay-handoff/REPLAY-BLOB-SPEC.md`.
- Local dev: prod snapshot in Docker PG on :5434 (`.env.development.local`);
  **never run against prod**. Payload blobs load read-only from prod Blob.
