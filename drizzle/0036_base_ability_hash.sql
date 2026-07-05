-- B221 follow-up: base functional identity. Fingerprint of a base's printed
-- ability text (lib/cards.baseAbilityHash) — same hash = functionally the
-- same base (LOF force pairs, reprints). Seeded by scripts/seed-cards.ts.
ALTER TABLE "cards" ADD COLUMN IF NOT EXISTS "base_ability_hash" text;
