-- B234: replay payload storage cost — compression marker + retention columns.
ALTER TABLE "replays" ADD COLUMN "payload_encoding" text;--> statement-breakpoint
ALTER TABLE "replays" ADD COLUMN "payload_pruned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "replays" ADD COLUMN "last_viewed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "replays_prune_idx" ON "replays" USING btree ("created_at") WHERE "replays"."payload_pruned_at" is null;
