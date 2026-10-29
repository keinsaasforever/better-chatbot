ALTER TABLE "navigator_workflows" ADD COLUMN IF NOT EXISTS "scaleway_function_id" text;
ALTER TABLE "navigator_workflows" ADD COLUMN IF NOT EXISTS "scaleway_region" text;
