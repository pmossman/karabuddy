# 0007 — Stats / Meta: frame-mined matchup + card analytics

**Status:** Proposed (B101, 2026-06). Planning; not yet built.

## Context

Every replay is a full frame-by-frame gamestate history (in Vercel Blob) plus
already-persisted per-match columns (`replays.players`, `winners`, `match`,
`decks`, `ownerPlayerId`). That's a rich dataset we don't yet surface as
analytics: leader-vs-leader matchups, archetype win rates, and card-level
signal ("wins more when drawn", "loses when played", by aspect/cost/turn).

Goal: a Stats/Meta surface that serves **three audiences from one dataset** —
the signed-in user's own replays (personal), a team's shared replays (scouting),
and the whole community (anonymized aggregate — the SWU-stats destination + SEO
growth play). First release covers **both** column-level stats (Tier A) and
frame-mined card-level stats (Tier B).

### Hard constraint: perspective masking

Recordings are single-perspective. The decoder strips the **opponent's hand,
deck, and resources** (`stripHiddenHandCards`); the opponent's `decks` entry is
leader/base only. Therefore:

- **Board-visible events** (a card reaches arena / discard / captured) are
  observable for **both** players → whole-meta-trustworthy.
- **Hand/deck/resource events** (drawn, resourced, in-hand) are reliable **only
  for the recorder's side**.

Any analytics design that ignores this produces silently-biased numbers.

## Decision

### Materialize derived facts into Postgres; never aggregate from blobs live

Blob payloads are not queryable and decoding is expensive, so we extract
structured facts **once** (at upload + a one-time backfill) and aggregate with
SQL. New tables (all additive — expand/contract safe per ADR 0005):

- **`cards`** — catalog keyed by `setId` (`SET_NNN`): `{name, aspects[], cost,
  type, arena, traits[]}`. **Seeded** from karabast-dev card data and
  **self-healing**: fact extraction upserts any unknown `cardId` straight from
  the payload's card object (which carries `name/aspects/cost/type/setId` for
  any visible card). New spoiler-season cards register the first time anyone
  plays one to a visible zone — no extension change, no manual catalog edits.
- **`match_facts`** — one denormalized row per `gameId` (dedup is free: `gameId`
  is uniquely indexed and multi-perspective uploads upsert into one replay row).
  Carries format, cardPool, bo3 mode, both players' leader/base/aspects + won
  flag, recorder side, duration, turn count, and quality flags. **Powers all of
  Tier A with plain SQL.**
- **`card_events`** — append-only, many per match: `{gameId, side, cardId,
  event, turn, sideWon, format, attribution}`. `event` is derived by **diffing
  each card's zone across consecutive frames by `uuid`**: deck→hand = `drawn`,
  hand→resources = `resourced`, hand→arena = `played`, →discard =
  `discarded`/`defeated`, plus `seen_in_play`.
- **`*_rollup`** — materialized aggregates refreshed by a Vercel cron. Stats
  pages read rollups, never raw events.

### Honesty via an `attribution` flag

Every `card_events` row records `attribution: 'both' | 'recorder'`:
`played`/`seen_in_play`/`discarded` → `both`; `drawn`/`resourced`/in-hand →
`recorder`. The UI shows each card stat's **sample size** and whether it's
whole-meta or recorder-side. Selection bias (people upload games they care
about) is disclosed as a caveat, not corrected.

### One scoping layer for three audiences

Facts carry their source replay identity; aggregation filters by audience:

- **Personal** — facts where `replay.userId = me`.
- **Team** — facts joined through `replay_team_shares` for team T.
- **Global** — all facts where the uploader hasn't opted out, emitted **only as
  aggregates above a min-N threshold** (never expose an individual game).

### Global is opt-OUT

Default-included for data density, with a `/settings` toggle
(`users.exclude_from_global_stats`) and a `/privacy` disclosure. Aggregate-only
output + the min-N threshold are the privacy guarantees; opt-out removes a
user's facts from the global corpus (personal/team unaffected).

### All formats, filtered

Facts store `format`/`cardPool`; the UI defaults to a sensible format but lets
you filter (premier / eternal / open / limited). No format is dropped at
extraction.

## Consequences

- **Backfill cost:** one batched, resumable job decodes every existing blob
  once. Ongoing extraction rides the upload path (idempotent on `gameId`,
  non-blocking — must never fail a write, same posture as `notifyMentions`).
- **Row volume:** `card_events` is dozens of rows/match × N matches. Index for
  the rollup queries; the cron-built rollups absorb read load.
- **Catalog completeness:** cards only ever in a masked zone (opponent
  hand/deck) never self-register — acceptable, since stats only reference cards
  we actually observed.
- **Turn/curve derivation** depends on a round/turn counter existing in the
  gamestate — verify in P0 before promising curve stats.

## Alternatives rejected

- **On-demand blob aggregation** — re-decoding payloads per page view doesn't
  scale; materialized facts + rollups instead.
- **Opt-in global** — safer but starves the global meta early; opt-out +
  aggregate-only + min-N is the chosen balance.
- **Extension-side catalog registration** — unnecessary; the server already
  receives full card metadata in the payload, so it self-heals server-side.

## Build phases

See **[B101]** in BACKLOG.md. P0 foundations (catalog + seed + self-heal,
`match_facts`/`card_events` migrations, `lib/statsExtract.ts`, upload wiring,
backfill, opt-out) → P1 rollups + cron + scoping + API → P2 `/stats` UI
(matchup matrix + archetype + card index/detail with sample-size + attribution
badges) → P3 growth (public SEO matchup pages, trends, deck-level spreads).
