-- B104 (ADR 0007): Bo3 set linkage on matches, so stats can filter to COMPLETE
-- best-of-three matches. lobby_id groups a set's games; game_number is this
-- game's position; bo3_wins_after is the winner's set-win count after this game
-- (a set is complete once some game in the lobby reaches 2). All nullable /
-- additive -> expand/contract safe. Populated going forward (the extension now
-- captures win-history) + by re-running the stats backfill where it's present.
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "lobby_id" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "game_number" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "bo3_wins_after" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "matches_lobby_idx" ON "matches" ("lobby_id");
