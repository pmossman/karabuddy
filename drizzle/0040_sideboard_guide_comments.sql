-- safe-migration: additive — new table + index only (expand/contract safe)
CREATE TABLE IF NOT EXISTS "sideboard_guide_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"guide_id" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sideboard_guide_comments" ADD CONSTRAINT "sideboard_guide_comments_guide_id_sideboard_guides_id_fk" FOREIGN KEY ("guide_id") REFERENCES "public"."sideboard_guides"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sideboard_guide_comments" ADD CONSTRAINT "sideboard_guide_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sideboard_guide_comments_guide_idx" ON "sideboard_guide_comments" USING btree ("guide_id");
