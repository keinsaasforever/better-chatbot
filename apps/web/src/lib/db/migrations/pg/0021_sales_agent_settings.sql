-- Sales Agent: per-user settings (CRM + outbound toolkit, run mode, system prompt)
CREATE TABLE IF NOT EXISTS "sales_agent_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"settings" jsonb NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "sales_agent_settings_org_user" UNIQUE ("org_id","user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_agent_settings_org_idx" ON "sales_agent_settings" USING btree ("org_id");
