-- B170 / ADR 0010: opt-in client-side E2EE for teams ("Private teams"). All
-- additive (new defaulted/nullable columns) -> expand/contract safe. The server
-- NEVER stores the team key — only the non-secret `team_key_id` (a non-invertible
-- HKDF of the key). The `encrypted` flag on replays is the seam every disabled/
-- rerouted feature keys off; old code ignores all of these.

-- Team opts into private mode. team_key_id = the active key's public id (null
-- until enabled). NEVER the key itself.
ALTER TABLE "teams" ADD COLUMN "private_mode" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "team_key_id" text;
--> statement-breakpoint

-- Encrypted replays: the payload blob (payload_blob_url) holds the E2EE envelope
-- ciphertext instead of plaintext JSON; encrypted_summary is the small
-- {leaders,bases,usernames,winner,displayName,labels} envelope the list/browse
-- UIs decrypt without pulling the whole payload. team_key_id records which key
-- is needed. On encrypted rows `players` is stored as [] (empty — that column
-- is NOT NULL) and match/decks/winners/display_name/labels stay NULL, so the
-- server can't (and must not) derive any plaintext identity/deck data.
ALTER TABLE "replays" ADD COLUMN "encrypted" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "replays" ADD COLUMN "team_key_id" text;
--> statement-breakpoint
ALTER TABLE "replays" ADD COLUMN "encrypted_summary" text;
--> statement-breakpoint

-- Encrypted tag comments: on a private replay the comment text is stored as an
-- E2EE envelope here; the plaintext `comment` column stays '' (mentions are
-- dropped for v1 — they name people). Reuses the replay's data key (ADR 0010).
ALTER TABLE "tags" ADD COLUMN "comment_encrypted" text;
