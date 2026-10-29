-- Blog Agent: per-user settings and generated posts for the code-hosted workflow
CREATE TABLE IF NOT EXISTS "blog_agent_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"settings" jsonb NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "blog_agent_settings_org_user" UNIQUE ("org_id","user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blog_agent_settings_org_idx" ON "blog_agent_settings" USING btree ("org_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blog_agent_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"slug" text,
	"summary" text,
	"image_url" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"publish_destinations" jsonb,
	"external_urls" jsonb,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blog_agent_posts_org_idx" ON "blog_agent_posts" USING btree ("org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blog_agent_posts_created_idx" ON "blog_agent_posts" USING btree ("created_at");
