-- Unattended browser automation: let scheduled agents drive a browser.
--
-- Until now the browser tool was suppressed on every scheduled run, because
-- the chat route gated it on `!headless` and the scheduled-task loopback is
-- headless by definition. Unblocking that needs two new opt-ins rather than
-- one, because "a person may drive a browser from chat" and "a robot may drive
-- one at 3am with nobody watching" are different risk decisions.
--
-- Org level: an admin enables unattended runs for the whole organization.
-- Task level: the owner of one schedule opts that schedule in, and pins which
-- stored credentials it may sign in with. Both default off, so no existing
-- organization or schedule changes behaviour on deploy.
--
-- The per-task flag is not ceremony: headful browser time bills at 128 credits
-- per second (docs/kernel-browser-billing.md), so a tool that bound by default
-- on every schedule would turn one slow run into a billing incident.
ALTER TABLE "organization_ai_policy"
  ADD COLUMN IF NOT EXISTS "browser_automation_unattended_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "scheduled_task"
  ADD COLUMN IF NOT EXISTS "browser_automation_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "scheduled_task"
  ADD COLUMN IF NOT EXISTS "browser_credential_aliases" text[];
