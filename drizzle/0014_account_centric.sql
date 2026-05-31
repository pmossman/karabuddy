-- safe-migration: contract — shipped before the expand/contract guard existed (B85).
-- The DROP COLUMN below co-deployed with the code that stopped reading
-- users.karabast_username; future drops must ship as a separate contract deploy.
CREATE TABLE "replay_participants" (
	"replay_slug" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "replay_participants_replay_slug_user_id_pk" PRIMARY KEY("replay_slug","user_id")
);--> statement-breakpoint
ALTER TABLE "replay_participants" ADD CONSTRAINT "replay_participants_replay_slug_replays_slug_fk" FOREIGN KEY ("replay_slug") REFERENCES "public"."replays"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replay_participants" ADD CONSTRAINT "replay_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "replay_participants_user_idx" ON "replay_participants" USING btree ("user_id");--> statement-breakpoint
INSERT INTO "replay_participants" ("replay_slug", "user_id") SELECT "slug", "user_id" FROM "replays" WHERE "user_id" IS NOT NULL ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "karabast_username";