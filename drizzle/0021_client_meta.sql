-- B114: client/recorder metadata attached by the extension's service worker at
-- upload time (ext version, browser/OS). Lets us see which extension version
-- produced a replay without asking the user — diagnosing recorder regressions
-- like the Bo3 capture gap. Additive nullable columns -> expand/contract safe
-- (the running deployment ignores them until the B114 code ships).
ALTER TABLE "replays" ADD COLUMN "client_meta" jsonb;--> statement-breakpoint
ALTER TABLE "replay_alt_payload" ADD COLUMN "alt_client_meta" jsonb;
