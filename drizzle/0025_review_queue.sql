-- B135: team review queue. A replay's share to a team can be flagged for
-- review by the uploader (NULL = not requested; a timestamp = requested at).
-- Anyone on the team can clear it (mark reviewed) by setting it back to NULL.
-- Additive nullable column -> expand/contract safe.
ALTER TABLE "replay_team_shares" ADD COLUMN "review_requested_at" timestamp;
--> statement-breakpoint
-- Partial index: the per-team review queue scans only the flagged subset.
CREATE INDEX IF NOT EXISTS "replay_team_shares_review_idx" ON "replay_team_shares" ("team_slug", "review_requested_at") WHERE "review_requested_at" IS NOT NULL;
