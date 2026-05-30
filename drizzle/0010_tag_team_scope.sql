CREATE TABLE "tag_team_scope" (
	"tag_id" text NOT NULL,
	"team_slug" text NOT NULL,
	CONSTRAINT "tag_team_scope_tag_id_team_slug_pk" PRIMARY KEY("tag_id","team_slug")
);
--> statement-breakpoint
ALTER TABLE "tag_team_scope" ADD CONSTRAINT "tag_team_scope_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_team_scope" ADD CONSTRAINT "tag_team_scope_team_slug_teams_slug_fk" FOREIGN KEY ("team_slug") REFERENCES "public"."teams"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tag_team_scope_team_idx" ON "tag_team_scope" USING btree ("team_slug");--> statement-breakpoint
CREATE INDEX "tag_team_scope_tag_idx" ON "tag_team_scope" USING btree ("tag_id");