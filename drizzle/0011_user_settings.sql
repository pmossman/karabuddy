ALTER TABLE "users" ADD COLUMN "default_share_team_slugs" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "min_upload_actions" integer DEFAULT 5 NOT NULL;