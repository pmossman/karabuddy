-- B136: replay clips. A clip is a [start,end] frame range of a replay (frames
-- stored in ORIGINAL space, like tags, so they survive a re-upload), with its
-- own shareable slug. Any viewer can create one; the creator (or the replay
-- owner) can delete it. Additive new table -> expand/contract safe.
CREATE TABLE IF NOT EXISTS "clips" (
  "slug" text PRIMARY KEY NOT NULL,
  "replay_slug" text NOT NULL REFERENCES "replays"("slug") ON DELETE CASCADE,
  "start_frame" integer NOT NULL,
  "end_frame" integer NOT NULL,
  "title" text,
  "user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clips_replay_idx" ON "clips" ("replay_slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clips_creator_idx" ON "clips" ("created_by");
