ALTER TABLE "tags" ADD COLUMN "parent_tag_id" text;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_parent_tag_id_tags_id_fk" FOREIGN KEY ("parent_tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tags_parent_idx" ON "tags" USING btree ("parent_tag_id");