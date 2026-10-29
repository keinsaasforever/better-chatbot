-- Workflow generator: a GitHub repo or web page as input.
--
-- `source_url` is what the user pasted; the background analyze job fetches it
-- server-side (repo content is never taken from the client) and prepends the
-- rendered files to `user_input_raw`, so refine and resume read the same
-- context. `source_commit_sha` pins the revision that was read, and doubles as
-- the "already ingested" marker so a re-run does not prepend the repo twice.
ALTER TABLE "navigator_workflows" ADD COLUMN IF NOT EXISTS "source_url" text;
--> statement-breakpoint
ALTER TABLE "navigator_workflows" ADD COLUMN IF NOT EXISTS "source_commit_sha" text;
