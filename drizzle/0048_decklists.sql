-- B236 (DB size): decklists stored once + per-replay refs (expand step). The
-- embedded `replays.decks` column stays until the contract migration; readers
-- fall back to it. Also strips the never-read user agent from client_meta.
CREATE TABLE "decklists" (
	"id" text PRIMARY KEY NOT NULL,
	"leader_id" text,
	"base_id" text,
	"cards" jsonb NOT NULL,
	"sideboard" jsonb NOT NULL,
	"card_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "decklists_leader_idx" ON "decklists" USING btree ("leader_id");--> statement-breakpoint
ALTER TABLE "replays" ADD COLUMN "deck_refs" jsonb;--> statement-breakpoint
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
UPDATE "replays" SET "client_meta" = "client_meta" - 'ua' WHERE "client_meta" ? 'ua';
