-- B124: team tournaments (Swiss / Bo3, async). Four additive tables ->
-- expand/contract safe (the running deployment ignores them until the B124
-- code ships). A tournament belongs to one team; entrants have an OPTIONAL
-- user_id (NULL = guest the organizer manages manually); a bye is a match row
-- with entrant2_id NULL; per-game results live in the `games` jsonb on the
-- match row; standings are derived on read (no standings table).
CREATE TABLE "tournaments" (
	"id" text PRIMARY KEY NOT NULL,
	"team_slug" text NOT NULL,
	"name" text NOT NULL,
	"created_by" text,
	"status" text DEFAULT 'setup' NOT NULL,
	"pairing_format" text DEFAULT 'swiss' NOT NULL,
	"match_format" text DEFAULT 'bo3' NOT NULL,
	"decklist_visibility" text DEFAULT 'hidden-until-start' NOT NULL,
	"planned_rounds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);--> statement-breakpoint
CREATE TABLE "tournament_entrants" (
	"id" text PRIMARY KEY NOT NULL,
	"tournament_id" text NOT NULL,
	"user_id" text,
	"display_name" text NOT NULL,
	"deck_link" text,
	"deck_name" text,
	"deck" jsonb,
	"dropped" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "tournament_rounds" (
	"id" text PRIMARY KEY NOT NULL,
	"tournament_id" text NOT NULL,
	"number" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"pairing_seed" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "tournament_matches" (
	"id" text PRIMARY KEY NOT NULL,
	"round_id" text NOT NULL,
	"tournament_id" text NOT NULL,
	"table_number" integer NOT NULL,
	"entrant1_id" text NOT NULL,
	"entrant2_id" text,
	"games" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result_source" text,
	"reported_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_team_slug_teams_slug_fk" FOREIGN KEY ("team_slug") REFERENCES "teams"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entrants" ADD CONSTRAINT "tournament_entrants_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entrants" ADD CONSTRAINT "tournament_entrants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_rounds" ADD CONSTRAINT "tournament_rounds_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_round_id_tournament_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "tournament_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_entrant1_id_tournament_entrants_id_fk" FOREIGN KEY ("entrant1_id") REFERENCES "tournament_entrants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_entrant2_id_tournament_entrants_id_fk" FOREIGN KEY ("entrant2_id") REFERENCES "tournament_entrants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tournaments_team_slug_idx" ON "tournaments" USING btree ("team_slug");--> statement-breakpoint
CREATE INDEX "tournament_entrants_tournament_idx" ON "tournament_entrants" USING btree ("tournament_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_entrants_tournament_user_idx" ON "tournament_entrants" USING btree ("tournament_id","user_id") WHERE user_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_rounds_tournament_number_idx" ON "tournament_rounds" USING btree ("tournament_id","number");--> statement-breakpoint
CREATE INDEX "tournament_matches_round_idx" ON "tournament_matches" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "tournament_matches_tournament_idx" ON "tournament_matches" USING btree ("tournament_id");
