-- safe-migration: additive — new table + index only (expand/contract safe)
-- B231: matchup-level discussion (any team member; keyed by the matchup).
CREATE TABLE IF NOT EXISTS "sideboard_matchup_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"team_slug" text NOT NULL,
	"own_leader" text NOT NULL,
	"own_base" text NOT NULL,
	"opp_leader" text NOT NULL,
	"opp_base" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sideboard_matchup_comments" ADD CONSTRAINT "sideboard_matchup_comments_team_slug_teams_slug_fk" FOREIGN KEY ("team_slug") REFERENCES "public"."teams"("slug") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sideboard_matchup_comments" ADD CONSTRAINT "sideboard_matchup_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sideboard_matchup_comments_matchup_idx" ON "sideboard_matchup_comments" USING btree ("team_slug","own_leader","own_base","opp_leader","opp_base");
