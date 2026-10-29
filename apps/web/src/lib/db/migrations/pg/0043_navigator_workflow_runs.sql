-- navigator_workflow_runs and navigator_workflow_metrics existed only in
-- schema.pg.ts (created via db:push on some environments, absent on others).
-- IF NOT EXISTS makes this migration safe either way.
CREATE TABLE IF NOT EXISTS "navigator_workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid,
	"org_id" text NOT NULL,
	"triggered_by" text,
	"status" text,
	"input_data" jsonb,
	"output_data" jsonb,
	"error_log" text,
	"started_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "navigator_workflow_runs" ADD CONSTRAINT "navigator_workflow_runs_workflow_id_navigator_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."navigator_workflows"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nav_wf_runs_wf_idx" ON "navigator_workflow_runs" ("workflow_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nav_wf_runs_org_idx" ON "navigator_workflow_runs" ("org_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "navigator_workflow_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"org_id" text NOT NULL,
	"executions_total" integer DEFAULT 0,
	"executions_7d" integer DEFAULT 0,
	"executions_24h" integer DEFAULT 0,
	"records_processed_total" integer DEFAULT 0,
	"avg_duration_ms" integer,
	"success_rate_pct" numeric(5, 2),
	"error_rate_pct" numeric(5, 2),
	"last_run_at" timestamp,
	"last_run_status" text,
	"custom_kpis" jsonb,
	"snapshot_source" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "navigator_workflow_metrics" ADD CONSTRAINT "navigator_workflow_metrics_workflow_id_navigator_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."navigator_workflows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nav_wf_metrics_wf_idx" ON "navigator_workflow_metrics" ("workflow_id");
