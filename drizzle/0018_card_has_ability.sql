-- B101 (ADR 0007): base granularity. Add a nullable `has_ability` flag to the
-- card catalog so the deck axis can keep ability bases (Tarkintown, Energy
-- Conversion Lab, the LAW "splash" bases) distinct while collapsing vanilla
-- aspect+HP bases to their aspect. Additive nullable column — expand/contract
-- safe (the running deployment never reads it). Backfilled by re-seeding the
-- catalog from swu-db (scripts/seed-cards.ts maps FrontText → has_ability).
ALTER TABLE "cards" ADD COLUMN IF NOT EXISTS "has_ability" boolean;
