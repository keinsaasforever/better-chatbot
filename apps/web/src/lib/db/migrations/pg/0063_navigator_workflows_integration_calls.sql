-- Workflow generator: outbound calls found in a source repo.
--
-- The analyze step lists every external operation the pasted code performs
-- (Gmail list threads, Slack post message, a vendor REST call, ...) and maps it
-- to a Composio action or marks it as a custom API. Action names are checked
-- against Composio's real action list before they are stored, so refine can
-- rely on them. Null for workflows that did not start from a source link.
ALTER TABLE "navigator_workflows" ADD COLUMN IF NOT EXISTS "integration_calls" jsonb;
