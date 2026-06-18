-- safe-migration: contract — every reader of replay_alt_payload was removed
-- across the B166 main deploy (double-sided serving moved to sibling rows; viewer
-- series nav) and this contract deploy (the "both POVs" chip on public / review /
-- tournament surfaces + My Replays). The sibling backfill already materialized
-- each alt as an independent `replays` row, so no data is lost. Dropped per the
-- expand/contract rule (ADR 0005) only after all referencing code is gone.
DROP TABLE IF EXISTS "replay_alt_payload";
