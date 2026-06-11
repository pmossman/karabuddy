-- B126: public tournament invite links + guest account-claim. Additive.
-- `invite_code` is a shareable capability (organizer-minted) that lets a
-- GUEST self-register via /tournaments/join?code=... without an account.
-- `claim_token` is a per-guest-entrant secret: a guest who later creates a
-- karabuddy account claims their entry with it (links userId + joins the team).
ALTER TABLE "tournaments" ADD COLUMN "invite_code" text;--> statement-breakpoint
CREATE UNIQUE INDEX "tournaments_invite_code_idx" ON "tournaments" USING btree ("invite_code") WHERE invite_code IS NOT NULL;--> statement-breakpoint
ALTER TABLE "tournament_entrants" ADD COLUMN "claim_token" text;
