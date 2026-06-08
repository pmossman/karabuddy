-- B112: double-sided replays. Keep the SECOND teammate's recording (its frames +
-- that player's unmasked hand) so the viewer can flip between perspectives.
-- Additive new table -> expand/contract safe (the running deployment ignores it
-- until the B112 code ships). PRIVATE: served only via the auth-gated
-- /perspective endpoint, never a public blob (@vercel/blob 0.27 has no private
-- access). A side table so the <=8MB payload never rides along on the broad
-- replays select()s the libraries do.
CREATE TABLE "replay_alt_payload" (
	"replay_slug" text PRIMARY KEY NOT NULL,
	"alt_user_id" text,
	"alt_owner_player_id" text,
	"alt_action_count" integer DEFAULT 0 NOT NULL,
	"payload" text NOT NULL
);--> statement-breakpoint
ALTER TABLE "replay_alt_payload" ADD CONSTRAINT "replay_alt_payload_replay_slug_replays_slug_fk" FOREIGN KEY ("replay_slug") REFERENCES "replays"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replay_alt_payload" ADD CONSTRAINT "replay_alt_payload_alt_user_id_users_id_fk" FOREIGN KEY ("alt_user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
