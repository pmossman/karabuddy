-- B167: SWU card titles are name + subtitle; two cards can share a name but
-- differ by subtitle (distinct cards). Add the column so the tournament deck
-- 3-copy limit keys on the full title (name + subtitle) instead of name alone.
-- Additive (nullable); the catalog reseed (scripts/seed-cards.ts) populates it.
ALTER TABLE "cards" ADD COLUMN "subtitle" text;
