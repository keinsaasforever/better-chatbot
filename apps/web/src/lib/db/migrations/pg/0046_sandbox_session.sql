-- Registry of E2B preview sandboxes.
--
-- Sandbox IDs previously lived only inside chat message tool-result JSON and
-- React state, so nothing server-side could reuse a thread's sandbox, check
-- its ownership without calling E2B, or reap one whose browser tab died before
-- it could pause it. E2B bills per second of running time, so an untracked
-- sandbox is an untracked bill.
--
-- thread_id is ON DELETE SET NULL, not CASCADE: deleting a thread does not
-- delete the sandbox at E2B, and cascading would drop the only record of
-- something that is still running.
CREATE TABLE IF NOT EXISTS "sandbox_session" (
	"sandbox_id" text PRIMARY KEY NOT NULL,
	"thread_id" uuid,
	"tool_call_id" text,
	"user_id" uuid NOT NULL,
	"organization_id" text,
	"template" text NOT NULL,
	"port" integer NOT NULL,
	"url" text NOT NULL,
	"state" varchar DEFAULT 'running' NOT NULL,
	"install_command_hash" text,
	"last_active_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sandbox_session" ADD CONSTRAINT "sandbox_session_thread_id_chat_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_thread"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sandbox_session" ADD CONSTRAINT "sandbox_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sandbox_session_thread_template_idx" ON "sandbox_session" ("thread_id","template","state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sandbox_session_user_idx" ON "sandbox_session" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sandbox_session_state_active_idx" ON "sandbox_session" ("state","last_active_at");
