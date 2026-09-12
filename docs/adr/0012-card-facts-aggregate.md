# ADR 0012 — Card facts as a per-side jsonb map, not per-event rows

**Status:** Accepted (B235) · 2026-09-12

## Context

ADR 0007 materialized card facts as `card_events`: one row per (game, side, card,
event) occurrence. By 2026-09-12 that was 6.6M rows and **1.4 GB of a 2.0 GB
database** — 70% of the whole Neon footprint, and the reason no free Postgres
tier (Neon 0.5 GB, Aiven 1 GB) could hold karabuddy. Swuforge, with more users,
keeps the same information in a ~1 kB per-game jsonb (`cardStats`) and has no
such table.

Every reader only ever needed two things from those rows: "did this card see
this event on this side of this game" (`getCardStats` collapses copies to one
observation per (game, side, card) before counting) and the FIRST frame it
happened on (the card finder). `attribution` was fully implied by the event kind
(drawn/resourced exist only on the recorder's side; played/discarded on both),
and `format` / `side_won` duplicated `matches` / `match_players`.

## Decision

- `match_players.card_events jsonb` — `{ drawn: { SET_NNN: firstFrame }, resourced,
  played, discarded }` for that side. Written by `persistReplayFacts` via
  `aggregateCardEvents` (lib/statsExtract.ts). Measured ~560 bytes per side on disk →
  **~140 MB** for the whole history instead of 1.4 GB (aggregation verified
  read-only against prod: identical per-card counts on a 5k-game sample).
- `getCardStats` and `/api/card-plays` read it with `jsonb_object_keys` /
  `jsonb_each_text` lateral joins. Because the facts now sit on the side's own
  row, the audience boundary is the same `scopePredicate` + `perspectiveCond`
  every other producer uses; the card-specific copies of those predicates are
  gone.
- Migration 0046 adds the column and backfills it from `card_events` in SQL
  (expand). **Dropping `card_events` is a separate, later migration** (contract,
  ADR 0005) once the reading code is deployed — that is when the 1.4 GB comes
  back. The `cardEvents` table stays in `lib/schema.ts` until then, marked legacy.
- Also in 0046: `teams.created_by`, `team_invites.created_by`,
  `replay_team_shares.shared_by` become nullable — their FKs are `ON DELETE SET
  NULL`, which Postgres accepted at DDL time but would have failed on the first
  user delete, and which CockroachDB rejects outright.

## Consequences

- No index on card ids any more: a card-stats query scans the scoped
  `match_players` rows and expands one jsonb key list per row. Personal/team
  scopes are hundreds to low thousands of rows; fine. A global (all-games) card
  query would expand ~260k rows — acceptable today, and a GIN index on the
  column is the escape hatch if it ever isn't.
- Copies of a card in one game are one observation, as before; per-copy counts
  are not kept (nothing displayed them).
- Ordering of frames within a game is by FIRST occurrence only.
