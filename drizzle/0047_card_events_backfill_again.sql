-- B235: idempotent re-run of the 0046 backfill for match_players rows that still
-- lack card_events. Needed because 0046 was applied to prod on 2026-09-12 by a
-- failed build, while the old code (which still writes card_events rows, not the
-- jsonb) kept running until the real deploy. Cheap: only null rows are touched.
UPDATE "match_players" mp SET "card_events" = agg.j
FROM (
  SELECT ce.game_id, ce.player_id, jsonb_object_agg(ce.event, ce.m) AS j
  FROM (
    SELECT game_id, player_id, event, jsonb_object_agg(card_id, first_frame) AS m
    FROM (
      SELECT c.game_id, c.player_id, c.event, c.card_id, min(c.frame_index) AS first_frame
      FROM "card_events" c
      JOIN "match_players" p ON p.game_id = c.game_id AND p.player_id = c.player_id AND p.card_events IS NULL
      GROUP BY 1, 2, 3, 4
    ) per_card
    GROUP BY 1, 2, 3
  ) ce
  GROUP BY 1, 2
) agg
WHERE mp.game_id = agg.game_id AND mp.player_id = agg.player_id AND mp.card_events IS NULL;
