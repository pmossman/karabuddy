-- B101 (ADR 0007): Stats/Meta fact tables + the global-stats opt-out column.
-- Fully additive (new tables + a new column with a default) — expand/contract
-- safe: the running deployment ignores all of this until the stats code ships.
ALTER TABLE "users" ADD COLUMN "exclude_from_global_stats" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE "cards" (
	"card_id" text PRIMARY KEY NOT NULL,
	"name" text,
	"set" text,
	"number" integer,
	"aspects" jsonb,
	"cost" integer,
	"type" text,
	"arena" text,
	"traits" jsonb,
	"source" text DEFAULT 'observed' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "matches" (
	"game_id" text PRIMARY KEY NOT NULL,
	"replay_slug" text NOT NULL,
	"format" text,
	"card_pool" text,
	"bo3" boolean,
	"result" text NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "match_players" (
	"game_id" text NOT NULL,
	"player_id" text NOT NULL,
	"username" text,
	"leader" text,
	"base" text,
	"aspects" jsonb,
	"is_recorder" boolean DEFAULT false NOT NULL,
	"won" boolean,
	"opponent_leader" text,
	"opponent_base" text,
	"format" text,
	CONSTRAINT "match_players_game_id_player_id_pk" PRIMARY KEY("game_id","player_id")
);--> statement-breakpoint
CREATE TABLE "card_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"player_id" text NOT NULL,
	"is_recorder" boolean DEFAULT false NOT NULL,
	"card_id" text NOT NULL,
	"event" text NOT NULL,
	"attribution" text NOT NULL,
	"frame_index" integer NOT NULL,
	"side_won" boolean,
	"format" text
);--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_replay_slug_replays_slug_fk" FOREIGN KEY ("replay_slug") REFERENCES "replays"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_game_id_matches_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "matches"("game_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_events" ADD CONSTRAINT "card_events_game_id_matches_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "matches"("game_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "matches_replay_idx" ON "matches" ("replay_slug");--> statement-breakpoint
CREATE INDEX "matches_format_idx" ON "matches" ("format");--> statement-breakpoint
CREATE INDEX "match_players_leader_idx" ON "match_players" ("leader");--> statement-breakpoint
CREATE INDEX "match_players_matchup_idx" ON "match_players" ("leader","opponent_leader");--> statement-breakpoint
CREATE INDEX "card_events_game_idx" ON "card_events" ("game_id");--> statement-breakpoint
CREATE INDEX "card_events_card_event_idx" ON "card_events" ("card_id","event");
