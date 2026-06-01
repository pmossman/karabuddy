-- B99: Discord DMs are strictly opt-in. Flip the column defaults to OFF and
-- reset every existing user/membership to OFF so no one is DM'd until they
-- explicitly opt in. (No destructive DDL — SET DEFAULT + data UPDATEs only;
-- backward-compatible with the running deployment, which reads these as the
-- kill-switch / opt-out it already understood.)
ALTER TABLE "users" ALTER COLUMN "notifications_disabled" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "team_member_prefs" ALTER COLUMN "dm_on_direct_mention" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "team_member_prefs" ALTER COLUMN "dm_on_team_mention" SET DEFAULT false;--> statement-breakpoint
UPDATE "users" SET "notifications_disabled" = true;--> statement-breakpoint
UPDATE "team_member_prefs" SET "dm_on_direct_mention" = false, "dm_on_team_mention" = false;
