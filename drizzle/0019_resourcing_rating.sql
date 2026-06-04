-- B101/Phase 3 (ADR 0007): persist a per-game resourcing rating on the recorder's
-- match_players row, so the /stats Resourcing trend aggregates with plain SQL
-- instead of re-decoding every replay. Raw components of the efficiency metric
-- (1 - wasted/available over counted rounds); nullable (opponent rows + games
-- recorded before this stay null) -> expand/contract safe. Backfilled by re-running
-- the stats backfill (persistReplayFacts now computes these).
ALTER TABLE "match_players" ADD COLUMN IF NOT EXISTS "resource_available" integer;--> statement-breakpoint
ALTER TABLE "match_players" ADD COLUMN IF NOT EXISTS "resource_wasted" integer;--> statement-breakpoint
ALTER TABLE "match_players" ADD COLUMN IF NOT EXISTS "resource_forced" integer;--> statement-breakpoint
ALTER TABLE "match_players" ADD COLUMN IF NOT EXISTS "resource_underspend" integer;--> statement-breakpoint
ALTER TABLE "match_players" ADD COLUMN IF NOT EXISTS "resource_dead_cards" integer;--> statement-breakpoint
ALTER TABLE "match_players" ADD COLUMN IF NOT EXISTS "resource_counted_rounds" integer;
