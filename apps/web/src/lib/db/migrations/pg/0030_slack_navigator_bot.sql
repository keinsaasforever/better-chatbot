CREATE TABLE IF NOT EXISTS "slack_workspace_connection" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "composio_connected_account_id" text NOT NULL,
  "composio_trigger_id" text,
  "composio_trigger_slug" text,
  "slack_team_id" text,
  "slack_team_name" text,
  "slack_bot_user_id" text,
  "status" varchar DEFAULT 'active' NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "slack_workspace_connection_composio_connected_account_id_unique" UNIQUE("composio_connected_account_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "slack_channel_subscription" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "connection_id" uuid NOT NULL,
  "channel_id" text NOT NULL,
  "channel_name" text,
  "is_private" boolean DEFAULT false NOT NULL,
  "agent_id" uuid,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "slack_channel_subscription_unique" UNIQUE("connection_id","channel_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "slack_agent_task" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "connection_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "agent_id" uuid,
  "status" varchar DEFAULT 'queued' NOT NULL,
  "input" text NOT NULL,
  "response_text" text,
  "error" text,
  "slack_channel_id" text NOT NULL,
  "slack_thread_ts" text NOT NULL,
  "slack_message_ts" text NOT NULL,
  "slack_user_id" text,
  "dedupe_key" text NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "completed_at" timestamp,
  CONSTRAINT "slack_agent_task_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "slack_workspace_connection" ADD CONSTRAINT "slack_workspace_connection_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "slack_channel_subscription" ADD CONSTRAINT "slack_channel_subscription_connection_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."slack_workspace_connection"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "slack_channel_subscription" ADD CONSTRAINT "slack_channel_subscription_agent_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "slack_agent_task" ADD CONSTRAINT "slack_agent_task_connection_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."slack_workspace_connection"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "slack_agent_task" ADD CONSTRAINT "slack_agent_task_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "slack_agent_task" ADD CONSTRAINT "slack_agent_task_agent_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "slack_connection_user_idx" ON "slack_workspace_connection" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "slack_connection_team_idx" ON "slack_workspace_connection" ("slack_team_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "slack_subscription_channel_idx" ON "slack_channel_subscription" ("channel_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "slack_agent_task_connection_idx" ON "slack_agent_task" ("connection_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "slack_agent_task_status_idx" ON "slack_agent_task" ("status");
