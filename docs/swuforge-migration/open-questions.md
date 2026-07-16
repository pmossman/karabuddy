# Open questions & decisions

Living list. Mark `[DECIDED]` with the answer + date when resolved.

## For Andy (swuforge dev)

1. **Do the sample v3 blobs render** in his viewer (board, chat, upgrades on the
   right host)? — sample pack sent; awaiting.
2. **Handoff mechanic** for real import: blob POSTed to an endpoint, dropped in R2
   (`games/{profileId}/{gameId}.json.gz`), or fetched from a karabuddy URL?
3. **v3 vs v4** on import (does his renderer need pre-derived credits/force/bounces
   ledgers, or is v3 board+chat enough)?
4. **Deck creation on his side.** Migration wants to auto-create *real* decks from
   karabuddy's full lists. Does swuforge expose a "create deck (+version)" ingest,
   and can a karabuddy import both create a deck AND connect replays to it (his
   M4/M5)? What deck-JSON shape (swudb `{leader,base,deck,sideboard}`, `SET_NNN`)?
5. **Team folders.** Can the migration create/populate a swuforge team folder
   (his `KarabastMatchTeam` scope) so a karabuddy team lands as a unit?
6. **Identity match** across apps by shared Google/Discord — confirmed approach?

## For Parker (product/UX)

7. **Team migration model.** Who initiates + who owns the result? Options:
   (a) owner migrates the *team's shared* replays into a swuforge **team folder**,
   teammates matched by identity + invited; (b) each member migrates their own; 
   (c) owner-only first, team later. *Leaning (a)* for the "migrate my whole team"
   ask, with per-member consent. **DECIDE — shapes the whole flow.**
8. **Consent granularity.** Per-deck? Per-member? All-or-nothing? Exporting to a
   third party is consent-gated (own-decks-only, encrypted replays excluded).
9. **Version detection aggressiveness.** Auto-split an archetype into versions
   (by decklist diff over time), or keep one deck per archetype + let the user
   split? How big a diff = a new version?
10. **Unlinkable replays** (partial/nextSet fragments, no complete deck): import as
    unlinked (Andy's M-plan) with a "connect later" nudge, or leave them behind?
11. **Entry point** in karabuddy: team settings tab? a dedicated `/teams/[slug]/
    migrate` page? A one-time banner?
12. **Name it.** "Migrate to SWU Forge" / "Send team to Forge" / "Forge export"?
13. **Reciprocal viewer** (watch swuforge replays in karabuddy) — bundle into the
    migration pitch ("keep both apps") or ship separately?

## Cross-cutting

14. **Encrypted (E2EE private-team) replays** can't be decoded server-side →
    excluded from server-side migration. Client-side (bridge-decrypt) path later?
15. **Backfill vs. live.** One-shot bulk migration, or an ongoing sync (new
    karabuddy games keep flowing to swuforge)? v1 = one-shot.
