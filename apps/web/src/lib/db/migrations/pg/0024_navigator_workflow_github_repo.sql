ALTER TABLE "navigator_workflows" ADD COLUMN IF NOT EXISTS "github_repo" text;
ALTER TABLE "navigator_workflows" ADD COLUMN IF NOT EXISTS "github_repo_url" text;
