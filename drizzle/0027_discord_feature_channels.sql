-- B144: per-feature Discord channel overrides on a team. Route review posts and
-- tournament posts to their own channels; NULL falls back to discord_channel_id
-- (the main team channel). Additive nullable columns -> expand/contract safe.
ALTER TABLE "teams" ADD COLUMN "discord_review_channel_id" text;
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "discord_tournament_channel_id" text;
