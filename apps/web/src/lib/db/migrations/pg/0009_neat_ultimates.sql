CREATE TABLE IF NOT EXISTS "mcp_oauth_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mcp_server_id" uuid NOT NULL,
	"server_url" text NOT NULL,
	"client_info" json,
	"tokens" json,
	"code_verifier" text,
	"state" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "mcp_oauth_session_mcp_server_id_unique" UNIQUE("mcp_server_id")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "mcp_oauth_session" ADD CONSTRAINT "mcp_oauth_session_mcp_server_id_mcp_server_id_fk" FOREIGN KEY ("mcp_server_id") REFERENCES "public"."mcp_server"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_oauth_data_server_id_idx" ON "mcp_oauth_session" USING btree ("mcp_server_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_oauth_data_state_idx" ON "mcp_oauth_session" USING btree ("state");