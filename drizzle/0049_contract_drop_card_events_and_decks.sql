-- safe-migration: contract — references removed in the B235/B236 deploy (PR #28):
-- card facts live on match_players.card_events (0046), decklists live in the
-- decklists table with replays.deck_refs (0048); no code reads or writes
-- card_events or replays.decks any more. Reclaims ~1.5 GB.
--
-- First convert any rows the previous code wrote between 0048 and this deploy
-- (same SQL as 0048), so nothing is lost when the column goes.
INSERT INTO "decklists" ("id", "leader_id", "base_id", "cards", "sideboard", "card_count")
SELECT DISTINCT ON (h) h, leader_id, base_id, cards, sideboard, card_count
FROM (
  SELECT
    md5(coalesce(v.value->'leader'->>'id', '') || '|' || coalesce(v.value->'base'->>'id', '') || '|' ||
        coalesce((SELECT string_agg((e->>'id') || ':' || (e->>'count')::int, ',' ORDER BY (e->>'id') COLLATE "C") FROM jsonb_array_elements(v.value->'deck') e WHERE e->>'id' IS NOT NULL), '') || '|' ||
        coalesce((SELECT string_agg((e->>'id') || ':' || (e->>'count')::int, ',' ORDER BY (e->>'id') COLLATE "C") FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v.value->'sideboard') = 'array' THEN v.value->'sideboard' ELSE '[]'::jsonb END) e WHERE e->>'id' IS NOT NULL), '')) AS h,
    v.value->'leader'->>'id' AS leader_id,
    v.value->'base'->>'id' AS base_id,
    coalesce((SELECT jsonb_agg(jsonb_build_array(e->>'id', (e->>'count')::int) ORDER BY (e->>'id') COLLATE "C") FROM jsonb_array_elements(v.value->'deck') e WHERE e->>'id' IS NOT NULL), '[]'::jsonb) AS cards,
    coalesce((SELECT jsonb_agg(jsonb_build_array(e->>'id', (e->>'count')::int) ORDER BY (e->>'id') COLLATE "C") FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v.value->'sideboard') = 'array' THEN v.value->'sideboard' ELSE '[]'::jsonb END) e WHERE e->>'id' IS NOT NULL), '[]'::jsonb) AS sideboard,
    coalesce((SELECT sum((e->>'count')::int) FROM jsonb_array_elements(v.value->'deck') e WHERE e->>'id' IS NOT NULL), 0)::int AS card_count
  FROM "replays" r, jsonb_each(r."decks") v
  WHERE r."decks" IS NOT NULL AND r."deck_refs" IS NULL AND jsonb_typeof(v.value->'deck') = 'array'
) s
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
UPDATE "replays" r SET "deck_refs" = (
  SELECT jsonb_object_agg(v.key, jsonb_build_object(
    'username', v.value->'username', 'name', v.value->'name', 'leader', v.value->'leader', 'base', v.value->'base',
    'decklist', CASE WHEN jsonb_typeof(v.value->'deck') = 'array' THEN
      md5(coalesce(v.value->'leader'->>'id', '') || '|' || coalesce(v.value->'base'->>'id', '') || '|' ||
        coalesce((SELECT string_agg((e->>'id') || ':' || (e->>'count')::int, ',' ORDER BY (e->>'id') COLLATE "C") FROM jsonb_array_elements(v.value->'deck') e WHERE e->>'id' IS NOT NULL), '') || '|' ||
        coalesce((SELECT string_agg((e->>'id') || ':' || (e->>'count')::int, ',' ORDER BY (e->>'id') COLLATE "C") FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v.value->'sideboard') = 'array' THEN v.value->'sideboard' ELSE '[]'::jsonb END) e WHERE e->>'id' IS NOT NULL), ''))
    ELSE NULL END))
  FROM jsonb_each(r."decks") v WHERE jsonb_typeof(v.value) = 'object')
WHERE r."decks" IS NOT NULL AND r."deck_refs" IS NULL;--> statement-breakpoint
-- B237: card facts only for recorded seats (the persist path stopped writing
-- opponent-side facts in the expand deploy; clear what older code wrote).
UPDATE "match_players" SET "card_events" = NULL WHERE NOT "is_recorder" AND "card_events" IS NOT NULL;--> statement-breakpoint
DROP TABLE "card_events";--> statement-breakpoint
ALTER TABLE "replays" DROP COLUMN "decks";
