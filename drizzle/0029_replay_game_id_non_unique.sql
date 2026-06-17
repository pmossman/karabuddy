-- B158 piece 2: relax gameId uniqueness so two NON-teammate opponents who both
-- record the same karabast game each keep their OWN replay (their POV), instead
-- of the 2nd upload being discarded. Drop the unique index; keep a plain lookup
-- index on game_id (still hot for the per-owner upsert lookup). Loosening a
-- constraint is backward-compatible (old code created at most one row per
-- gameId), so this co-deploys safely with the new upload logic.
DROP INDEX IF EXISTS "replays_game_id_idx";
--> statement-breakpoint
CREATE INDEX "replays_game_id_idx" ON "replays" USING btree ("game_id");
