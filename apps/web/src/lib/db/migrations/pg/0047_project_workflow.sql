CREATE TABLE IF NOT EXISTS "project_workflow" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "workflow_id" uuid NOT NULL,
  "added_by" uuid,
  "status" varchar DEFAULT 'active' NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_workflow" ADD CONSTRAINT "project_workflow_project_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_workflow" ADD CONSTRAINT "project_workflow_workflow_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_workflow" ADD CONSTRAINT "project_workflow_added_by_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_workflow" ADD CONSTRAINT "project_workflow_unique" UNIQUE ("project_id","workflow_id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_workflow_project_idx" ON "project_workflow" USING btree ("project_id");
