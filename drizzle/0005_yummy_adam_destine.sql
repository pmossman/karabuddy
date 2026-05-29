CREATE TABLE "replay_team_shares" (
	"replay_slug" text NOT NULL,
	"team_slug" text NOT NULL,
	"shared_by" text NOT NULL,
	"shared_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "replay_team_shares_replay_slug_team_slug_pk" PRIMARY KEY("replay_slug","team_slug")
);
--> statement-breakpoint
ALTER TABLE "replay_team_shares" ADD CONSTRAINT "replay_team_shares_replay_slug_replays_slug_fk" FOREIGN KEY ("replay_slug") REFERENCES "public"."replays"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replay_team_shares" ADD CONSTRAINT "replay_team_shares_team_slug_teams_slug_fk" FOREIGN KEY ("team_slug") REFERENCES "public"."teams"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replay_team_shares" ADD CONSTRAINT "replay_team_shares_shared_by_users_id_fk" FOREIGN KEY ("shared_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "replay_team_shares_team_idx" ON "replay_team_shares" USING btree ("team_slug");--> statement-breakpoint
CREATE INDEX "replay_team_shares_replay_idx" ON "replay_team_shares" USING btree ("replay_slug");