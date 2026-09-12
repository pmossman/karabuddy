-- B235 (DB size): per-side card facts move from the 6.6M-row card_events table
-- to one jsonb per match_players row: { event: { cardId: firstFrameIndex } }.
-- Expand step (ADR 0005): add + backfill here; card_events is dropped by a later
-- migration once the reading code is live.
ALTER TABLE "match_players" ADD COLUMN "card_events" jsonb;--> statement-breakpoint
UPDATE "match_players" mp SET "card_events" = agg.j
FROM (
  SELECT game_id, player_id, jsonb_object_agg(event, m) AS j
  FROM (
    SELECT game_id, player_id, event, jsonb_object_agg(card_id, first_frame) AS m
    FROM (
      SELECT game_id, player_id, event, card_id, min(frame_index) AS first_frame
      FROM "card_events"
      GROUP BY 1, 2, 3, 4
    ) per_card
    GROUP BY 1, 2, 3
  ) per_event
  GROUP BY 1, 2
) agg
WHERE mp.game_id = agg.game_id AND mp.player_id = agg.player_id;--> statement-breakpoint
-- CockroachDB compatibility (Postgres tolerated these at DDL time, and would have
-- failed at DELETE time): a SET NULL cascade needs a nullable column.
ALTER TABLE "teams" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "team_invites" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "replay_team_shares" ALTER COLUMN "shared_by" DROP NOT NULL;
