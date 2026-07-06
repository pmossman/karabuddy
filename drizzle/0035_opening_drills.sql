-- B221: Team Opening Drills. Two additive tables -> expand/contract safe.
--
-- replay_openings: one row per replay — the recorder's opening decision slice
-- (extracted at upload via the persistStatsSafe posture + backfill). Absent
-- for replays with no usable setup and for encrypted payloads (ADR 0010).
CREATE TABLE IF NOT EXISTS "replay_openings" (
  "replay_slug" text PRIMARY KEY NOT NULL REFERENCES "replays"("slug") ON DELETE CASCADE,
  "recorder_id" text NOT NULL,
  "decision" text NOT NULL,
  "dealt_hand" jsonb NOT NULL,
  "kept_hand" jsonb NOT NULL,
  "resourced" jsonb NOT NULL,
  "mulligan_frame_index" integer NOT NULL,
  "resource_frame_index" integer NOT NULL,
  "went_first" boolean,
  "extractor_version" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- opening_responses: a member's answer to an opening drill. Keyed (replay,
-- responder) with DELIBERATELY no team column — visibility of others'
-- responses is scoped at read time (viewer's team members; replay owner sees
-- all), which keeps a future public/crowdsourced mode a read-scope change.
CREATE TABLE IF NOT EXISTS "opening_responses" (
  "replay_slug" text NOT NULL REFERENCES "replays"("slug") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "decision" text NOT NULL,
  "resourced" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "opening_responses_replay_slug_user_id_pk" PRIMARY KEY("replay_slug","user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opening_responses_user_idx" ON "opening_responses" ("user_id");
