CREATE TABLE "replays" (
	"slug" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"owner_token" text NOT NULL,
	"players" jsonb NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"action_count" integer DEFAULT 0 NOT NULL,
	"payload_blob_url" text NOT NULL,
	"payload_size_bytes" integer DEFAULT 0 NOT NULL,
	"visibility" text DEFAULT 'unlisted' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" text PRIMARY KEY NOT NULL,
	"replay_slug" text NOT NULL,
	"frame_index" integer NOT NULL,
	"author_token" text NOT NULL,
	"author_name" text NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_replay_slug_replays_slug_fk" FOREIGN KEY ("replay_slug") REFERENCES "public"."replays"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "replays_game_id_idx" ON "replays" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "replays_owner_idx" ON "replays" USING btree ("owner_token");--> statement-breakpoint
CREATE INDEX "replays_created_at_idx" ON "replays" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "tags_replay_idx" ON "tags" USING btree ("replay_slug");--> statement-breakpoint
CREATE INDEX "tags_author_idx" ON "tags" USING btree ("author_token");