-- Baseline for schema that was applied out of band.
--
-- The Better Auth organization plugin tables and the session columns that go
-- with them were pushed straight to the deployed databases and never had a
-- migration of their own. A replay of this journal against an empty database
-- therefore failed at 0032, which joins "member" and "organization".
--
-- Everything here is idempotent, and the journal timestamp places it before
-- the first migration that depends on these objects. Databases that already
-- have them (production, staging) are past this point in the ledger and skip
-- the file entirely; the guards are the second line of defence.

CREATE TABLE IF NOT EXISTS "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"logo" text,
	"metadata" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"inviter_id" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "member_organization_id_idx" ON "member" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "member_user_id_idx" ON "member" USING btree ("user_id");
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "impersonated_by" text;
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "active_organization_id" text;
--> statement-breakpoint
-- The model catalog started life as a Supabase-managed table. 0034 normalizes
-- it into the current shape (and preserves legacy columns where they exist),
-- so the baseline only has to guarantee the table and its key.
CREATE TABLE IF NOT EXISTS "models" (
	"model" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
-- Workflow-generator storage, likewise created out of band. Columns added by
-- 0016-0024 are left to those migrations; everything else is original shape.
CREATE TABLE IF NOT EXISTS "navigator_workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"created_by" text NOT NULL,
	"display_name" text NOT NULL,
	"trigger_handle" text NOT NULL,
	"hosting_type" text NOT NULL,
	"execution_url" text,
	"github_repo_path" text,
	"diagram_mermaid" text,
	"tool_list" jsonb,
	"follow_up_questions" jsonb,
	"user_answers" jsonb,
	"refined_diagram_mermaid" text,
	"automation_spec" jsonb,
	"workflow_summary" text,
	"n8n_template_matches" jsonb,
	"analysis_summary" text,
	"current_step" integer DEFAULT 1,
	"autumn_product_id" text,
	"payment_status" text DEFAULT 'unpaid',
	"plan_tier" text,
	"build_status" text DEFAULT 'draft',
	"is_active" boolean DEFAULT false,
	"last_deployed_at" timestamp,
	"bitwarden_collection_id" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nav_wf_org_id_idx" ON "navigator_workflows" USING btree ("org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nav_wf_build_status_idx" ON "navigator_workflows" USING btree ("build_status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nav_wf_created_by_idx" ON "navigator_workflows" USING btree ("created_by");
