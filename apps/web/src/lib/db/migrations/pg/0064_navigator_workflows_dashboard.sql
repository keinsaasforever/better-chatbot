-- Workflow generator: per-workflow end-user dashboard and database.
--
-- `dashboard_url` is where the workflow container serves its dashboard; the
-- "Open dashboard" button mints a one-time login token for it
-- (/api/workflow-generator/submissions/[id]/dashboard-session).
-- `workflow_db_name` names the database + user provisioned for the workflow
-- on the shared Scaleway managed Postgres instance, so it can be dropped when
-- the workflow is deleted. Its connection string lives only in Scaleway
-- Secret Manager and the container's secret env (DATABASE_URL).
ALTER TABLE "navigator_workflows" ADD COLUMN IF NOT EXISTS "dashboard_url" text;
--> statement-breakpoint
ALTER TABLE "navigator_workflows" ADD COLUMN IF NOT EXISTS "workflow_db_name" text;
