-- safe-migration: additive columns for manual result assignment. winner_manual has a default (backfills existing rows in place, no rewrite lock in PG11+); result_set_at is nullable.
ALTER TABLE "replays" ADD COLUMN "winner_manual" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "replays" ADD COLUMN "result_set_at" timestamp with time zone;
