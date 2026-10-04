ALTER TABLE "teams" ADD COLUMN "forge_team_id" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "forge_team_url" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "forge_moved_at" timestamp with time zone;
