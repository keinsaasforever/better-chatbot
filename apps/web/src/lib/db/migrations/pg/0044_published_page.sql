-- Published snapshots of sandbox-built pages, served at a stable /p/{slug}.
--
-- Append-only: a slug resolves to its newest non-revoked version, so the URL
-- stays fixed while the author keeps editing, and a bad publish is rolled back
-- by setting revoked_at rather than deleting history.
CREATE TABLE IF NOT EXISTS "published_page" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"html" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"organization_id" text,
	"thread_id" uuid,
	"published_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	CONSTRAINT "published_page_slug_version_unique" UNIQUE("slug","version")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "published_page" ADD CONSTRAINT "published_page_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "published_page_slug_idx" ON "published_page" ("slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "published_page_owner_idx" ON "published_page" ("owner_id");
