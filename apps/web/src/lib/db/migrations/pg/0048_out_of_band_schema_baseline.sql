-- Close the remaining gap between the migration journal and schema.pg.ts.
--
-- These objects were applied straight to the deployed databases and never had
-- a migration, so a replay produced a database the code could not run against
-- (most visibly `agent.preset_id`, which every sign-up writes when seeding
-- preset agents). Everything here is idempotent: deployments that already have
-- these objects are unaffected, fresh installs get them.
--
-- Kept out of 0015 deliberately — nothing between 0016 and 0047 depends on
-- these, so they belong at the tail where they cannot perturb that sequence.

ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "preset_id" varchar(100);
--> statement-breakpoint
ALTER TABLE "navigator_preferred_tools" ADD COLUMN IF NOT EXISTS "primary_tool" text;
--> statement-breakpoint
ALTER TABLE "navigator_preferred_tools" ADD COLUMN IF NOT EXISTS "secondary_tool" text;
--> statement-breakpoint
ALTER TABLE "navigator_preferred_tools" ADD COLUMN IF NOT EXISTS "docs_url" text;
--> statement-breakpoint
ALTER TABLE "navigator_preferred_tools" ADD COLUMN IF NOT EXISTS "example_code" text;
--> statement-breakpoint
ALTER TABLE "navigator_preferred_tools" ADD COLUMN IF NOT EXISTS "in_composio" boolean;
--> statement-breakpoint
ALTER TABLE "navigator_preferred_tools" ADD COLUMN IF NOT EXISTS "is_eu_hosted" boolean;
--> statement-breakpoint
ALTER TABLE "navigator_preferred_tools" ADD COLUMN IF NOT EXISTS "is_hidden_gem" boolean;
--> statement-breakpoint
ALTER TABLE "navigator_preferred_tools" ADD COLUMN IF NOT EXISTS "is_self_hostable" boolean;
--> statement-breakpoint
ALTER TABLE "navigator_preferred_tools" ADD COLUMN IF NOT EXISTS "via_autumn" boolean;
--> statement-breakpoint
-- Backfill from the legacy single-column shape before enforcing NOT NULL.
UPDATE "navigator_preferred_tools"
SET "primary_tool" = COALESCE("primary_tool", "tool_name")
WHERE "primary_tool" IS NULL
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'navigator_preferred_tools'
      AND column_name = 'tool_name'
  );
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "navigator_preferred_tools" WHERE "primary_tool" IS NULL
  ) THEN
    ALTER TABLE "navigator_preferred_tools" ALTER COLUMN "primary_tool" SET NOT NULL;
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_edit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"change_id" text NOT NULL,
	"del_w_id" text,
	"ins_w_id" text,
	"deleted_text" text DEFAULT '' NOT NULL,
	"inserted_text" text DEFAULT '' NOT NULL,
	"context_before" text DEFAULT '' NOT NULL,
	"context_after" text DEFAULT '' NOT NULL,
	"reason" text,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"edited_storage_key" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tabular_review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"columns" json NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tabular_review_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"row_index" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tabular_review_doc_unique" UNIQUE("review_id","document_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tabular_cell" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"column_id" text NOT NULL,
	"value" text,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "tabular_cell_unique" UNIQUE("review_id","document_id","column_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "navigator_workflow_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"granted_by" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "navigator_workflow_access_workflow_id_user_id_unique" UNIQUE("workflow_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "navigator_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"org_id" text NOT NULL,
	"submitted_by" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"priority" text DEFAULT 'normal',
	"status" text DEFAULT 'open',
	"admin_notes" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "navigator_connected_tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"workflow_id" uuid,
	"tool_name" text NOT NULL,
	"auth_type" text,
	"external_secret_id" text,
	"status" text DEFAULT 'pending',
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "nav_connected_tools_unique" UNIQUE("org_id","workflow_id","tool_name")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "document_edit" ADD CONSTRAINT "document_edit_document_id_document_id_fk"
		FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "document_edit" ADD CONSTRAINT "document_edit_user_id_user_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "tabular_review" ADD CONSTRAINT "tabular_review_user_id_user_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "tabular_review_document" ADD CONSTRAINT "tabular_review_document_review_id_tabular_review_id_fk"
		FOREIGN KEY ("review_id") REFERENCES "public"."tabular_review"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "tabular_review_document" ADD CONSTRAINT "tabular_review_document_document_id_document_id_fk"
		FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "tabular_cell" ADD CONSTRAINT "tabular_cell_review_id_tabular_review_id_fk"
		FOREIGN KEY ("review_id") REFERENCES "public"."tabular_review"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "tabular_cell" ADD CONSTRAINT "tabular_cell_document_id_document_id_fk"
		FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "navigator_workflow_access" ADD CONSTRAINT "navigator_workflow_access_workflow_id_navigator_workflows_id_fk"
		FOREIGN KEY ("workflow_id") REFERENCES "public"."navigator_workflows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "navigator_change_requests" ADD CONSTRAINT "navigator_change_requests_workflow_id_navigator_workflows_id_fk"
		FOREIGN KEY ("workflow_id") REFERENCES "public"."navigator_workflows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "navigator_connected_tools" ADD CONSTRAINT "navigator_connected_tools_workflow_id_navigator_workflows_id_fk"
		FOREIGN KEY ("workflow_id") REFERENCES "public"."navigator_workflows"("id") ON UPDATE no action ON DELETE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_edit_change_id_idx" ON "document_edit" USING btree ("change_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_edit_document_id_idx" ON "document_edit" USING btree ("document_id");
--> statement-breakpoint
-- The legacy single-column shape, now backfilled into "primary_tool" above.
ALTER TABLE "navigator_preferred_tools" DROP COLUMN IF EXISTS "tool_name";
--> statement-breakpoint
-- schema.pg.ts declares this jsonb; the deployed column is json.
--
-- NOTE FOR DEPLOYED DATABASES: this rewrites chat_message under an ACCESS
-- EXCLUSIVE lock, so on a large table apply it during a maintenance window
-- rather than alongside a routine deploy. Fresh databases are empty and the
-- conversion is instant. The guard makes re-running free.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'chat_message'
      AND column_name = 'metadata' AND data_type = 'json'
  ) THEN
    ALTER TABLE "chat_message"
      ALTER COLUMN "metadata" TYPE jsonb USING "metadata"::jsonb;
  END IF;
END $$;
