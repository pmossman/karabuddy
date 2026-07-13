-- safe-migration: additive — new table + indexes only (expand/contract safe)
CREATE TABLE IF NOT EXISTS "sideboard_guides" (
	"id" text PRIMARY KEY NOT NULL,
	"team_slug" text NOT NULL,
	"author_id" text NOT NULL,
	"own_leader" text NOT NULL,
	"own_base" text NOT NULL,
	"opp_leader" text NOT NULL,
	"opp_base" text NOT NULL,
	"title" text,
	"notes" text DEFAULT '' NOT NULL,
	"cards_in" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cards_out" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sideboard_guides" ADD CONSTRAINT "sideboard_guides_team_slug_teams_slug_fk" FOREIGN KEY ("team_slug") REFERENCES "public"."teams"("slug") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sideboard_guides" ADD CONSTRAINT "sideboard_guides_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sideboard_guides_team_idx" ON "sideboard_guides" USING btree ("team_slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sideboard_guides_matchup_idx" ON "sideboard_guides" USING btree ("team_slug","own_leader","opp_leader");
