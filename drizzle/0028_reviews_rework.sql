-- B149 / ADR 0009: durable, multi-reviewer team reviews + the "new since last
-- view" marker. All additive (new nullable column + two new tables) -> expand/
-- contract safe.

-- Who requested the review (drives the requester's "my requests" surface). The
-- request timestamp (review_requested_at, 0025) now PERSISTS through review —
-- it's the ask, not the completion. Additive nullable column.
ALTER TABLE "replay_team_shares" ADD COLUMN "review_requested_by" text REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint

-- A reviewer's explicit "I reviewed this" mark, one row per (replay, team,
-- reviewer). Replaces the single vanishing boolean: marks accumulate ("reviewed
-- by N") and never wipe the request. Reviews are per-team (mirrors the per-team
-- request model).
CREATE TABLE IF NOT EXISTS "replay_reviews" (
  "id" text PRIMARY KEY NOT NULL,
  "replay_slug" text NOT NULL REFERENCES "replays"("slug") ON DELETE CASCADE,
  "team_slug" text NOT NULL REFERENCES "teams"("slug") ON DELETE CASCADE,
  "reviewer_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "reviewed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- One mark per person per team per replay (upsert target).
CREATE UNIQUE INDEX IF NOT EXISTS "replay_reviews_unique" ON "replay_reviews" ("replay_slug", "team_slug", "reviewer_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "replay_reviews_team_idx" ON "replay_reviews" ("team_slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "replay_reviews_replay_idx" ON "replay_reviews" ("replay_slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "replay_reviews_reviewer_idx" ON "replay_reviews" ("reviewer_user_id");
--> statement-breakpoint

-- Per-user last-viewed timestamp, for the "new tags since you last looked"
-- marker in the viewer's review panel (cross-device). Upserted on each open.
CREATE TABLE IF NOT EXISTS "replay_views" (
  "replay_slug" text NOT NULL REFERENCES "replays"("slug") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "viewed_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "replay_views_pk" PRIMARY KEY ("replay_slug", "user_id")
);
