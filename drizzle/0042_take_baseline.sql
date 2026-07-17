-- safe-migration: additive nullable column; existing takes keep NULL (pool-authored)
ALTER TABLE "sideboard_takes" ADD COLUMN "baseline" jsonb;
