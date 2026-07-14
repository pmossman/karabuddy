-- safe-migration: additive nullable column; backfilled by the card sync (seed-cards)
ALTER TABLE "cards" ADD COLUMN "base_subtype" text;
