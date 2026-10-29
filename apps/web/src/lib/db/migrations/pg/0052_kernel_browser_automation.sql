-- Kernel browser automation: org-level opt-in.
--
-- Defaults to false so existing organizations are unaffected until an admin
-- turns it on. This is the one tool that drives a real browser against
-- arbitrary websites, and at headful rates a single long run can consume a
-- Free workspace's entire monthly credit allowance, so it is opt-in on both
-- counts. Read by `lib/ai/routing/service.ts` and toggled from the AI policy
-- tab in org settings.
ALTER TABLE "organization_ai_policy"
  ADD COLUMN IF NOT EXISTS "browser_automation_enabled" boolean DEFAULT false NOT NULL;
