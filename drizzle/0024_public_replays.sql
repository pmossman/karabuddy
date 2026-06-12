-- B133: owner-controlled PUBLIC replays (the B85 concept returns, narrower:
-- explicit per-replay opt-in by the uploader, with comment redaction for
-- non-entitled viewers). NULL = unlisted (link-accessible only, the default);
-- a timestamp = when the owner made it public — also the public browser's
-- sort key. Additive nullable column -> expand/contract safe.
ALTER TABLE "replays" ADD COLUMN "public_at" timestamp;
--> statement-breakpoint
-- Partial index: the public listing scans only the (tiny) public subset.
CREATE INDEX IF NOT EXISTS "replays_public_at_idx" ON "replays" ("public_at") WHERE "public_at" IS NOT NULL;
