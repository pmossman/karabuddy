-- Newest in-app announcement version each user has dismissed (null = none).
ALTER TABLE "users" ADD COLUMN "announcement_dismissed_version" integer;
