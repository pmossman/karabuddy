ALTER TABLE "users" ADD COLUMN "notifications_disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "discord_guild_id" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "discord_channel_id" text;--> statement-breakpoint
CREATE TABLE "team_member_prefs" (
	"team_slug" text NOT NULL,
	"user_id" text NOT NULL,
	"dm_on_direct_mention" boolean DEFAULT true NOT NULL,
	"dm_on_team_mention" boolean DEFAULT true NOT NULL,
	CONSTRAINT "team_member_prefs_team_slug_user_id_pk" PRIMARY KEY("team_slug","user_id")
);--> statement-breakpoint
ALTER TABLE "team_member_prefs" ADD CONSTRAINT "team_member_prefs_team_slug_teams_slug_fk" FOREIGN KEY ("team_slug") REFERENCES "public"."teams"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member_prefs" ADD CONSTRAINT "team_member_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;