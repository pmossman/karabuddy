-- safe-migration: additive index only, no data or column change
-- B233: personal stats scope each fact row by "does this user hold a replay for
-- this game, on this seat?" (lib/statsQuery.personalSeatCond). This covers that
-- EXISTS end to end so it stays an index lookup instead of scanning replays.
CREATE INDEX IF NOT EXISTS "replays_user_game_owner_idx" ON "replays" ("user_id","game_id","owner_player_id");
