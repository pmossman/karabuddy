-- B170 / ADR 0010: per-user extension readiness, powering the owner's private-team
-- roster (ready / needs-update / needs-key). The extension pings this with its
-- NON-SECRET capabilities + the team_key_ids it has loaded — never the key. All
-- additive (new table) -> expand/contract safe.
CREATE TABLE IF NOT EXISTS "extension_readiness" (
  "user_id" text PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "capabilities" jsonb,
  "loaded_key_ids" jsonb,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
