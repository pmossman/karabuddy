-- B224: series grouping + the Bo1→Bo3 stats reconcile scan a lobby's games by
-- match->>'lobbyId' (the reconcile runs on the upload path). Index the JSON
-- expression so those become index lookups instead of seq scans. Additive +
-- idempotent; safe under expand/contract (CREATE INDEX on the small replays
-- table takes a brief lock and no schema is removed).
-- safe-migration: additive CREATE INDEX, no destructive DDL
CREATE INDEX IF NOT EXISTS "replays_lobby_idx" ON "replays" USING btree (("match" ->> 'lobbyId'));
