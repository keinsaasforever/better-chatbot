-- Add enhanced_description to navigator_workflows (stores AI-enriched process
-- description from the analyze step; used as n8nac search query in refine step)
ALTER TABLE "navigator_workflows" ADD COLUMN IF NOT EXISTS "enhanced_description" text;
--> statement-breakpoint

-- Preferred tools catalog — curated tool recommendations queried by the analyze
-- AI step to pick the best tool per task category instead of guessing.
CREATE TABLE IF NOT EXISTS "navigator_preferred_tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"task_keywords" text NOT NULL,
	"tool_name" text NOT NULL,
	"composio_slug" text,
	"n8n_node_type" text,
	"auth_type" text,
	"notes" text,
	"priority" integer DEFAULT 1,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nav_pref_tools_category_idx" ON "navigator_preferred_tools" USING btree ("category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nav_pref_tools_active_idx" ON "navigator_preferred_tools" USING btree ("is_active");
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'nav_pref_tools_unique'
  ) THEN
    ALTER TABLE "navigator_preferred_tools"
      ADD CONSTRAINT "nav_pref_tools_unique" UNIQUE ("category","tool_name");
  END IF;
END $$;
