-- B227: Team Sideboarding Drills — a sideboard decision per Bo3 transition
-- (replay_sideboards) + members' answers (sideboard_responses). Additive.
CREATE TABLE "replay_sideboards" (
	"replay_slug" text PRIMARY KEY NOT NULL,
	"previous_slug" text NOT NULL,
	"recorder_id" text NOT NULL,
	"lobby_id" text NOT NULL,
	"game_number" integer NOT NULL,
	"deck" jsonb NOT NULL,
	"sideboard" jsonb NOT NULL,
	"swapped_in" jsonb NOT NULL,
	"swapped_out" jsonb NOT NULL,
	"won_previous" boolean,
	"extractor_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sideboard_responses" (
	"replay_slug" text NOT NULL,
	"user_id" text NOT NULL,
	"swapped_in" jsonb NOT NULL,
	"swapped_out" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sideboard_responses_replay_slug_user_id_pk" PRIMARY KEY("replay_slug","user_id")
);
--> statement-breakpoint
ALTER TABLE "replay_sideboards" ADD CONSTRAINT "replay_sideboards_replay_slug_replays_slug_fk" FOREIGN KEY ("replay_slug") REFERENCES "public"."replays"("slug") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sideboard_responses" ADD CONSTRAINT "sideboard_responses_replay_slug_replays_slug_fk" FOREIGN KEY ("replay_slug") REFERENCES "public"."replays"("slug") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sideboard_responses" ADD CONSTRAINT "sideboard_responses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "sideboard_responses_user_idx" ON "sideboard_responses" USING btree ("user_id");
