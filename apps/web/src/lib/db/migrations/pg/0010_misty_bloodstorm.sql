DO $$ BEGIN
	ALTER TABLE "mcp_oauth_session" DROP CONSTRAINT IF EXISTS "mcp_oauth_session_mcp_server_id_unique";
EXCEPTION
	WHEN undefined_object THEN null;
END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "mcp_oauth_data_server_id_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "mcp_oauth_data_state_idx";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_oauth_session_server_id_idx" ON "mcp_oauth_session" USING btree ("mcp_server_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_oauth_session_state_idx" ON "mcp_oauth_session" USING btree ("state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_oauth_session_tokens_idx" ON "mcp_oauth_session" USING btree ("mcp_server_id") WHERE "mcp_oauth_session"."tokens" is not null;
--> statement-breakpoint
DO $$ BEGIN
	-- Check if constraint exists and add if not
	IF NOT EXISTS (
		SELECT 1 FROM information_schema.table_constraints 
		WHERE constraint_name = 'mcp_oauth_session_state_unique' 
		AND table_name = 'mcp_oauth_session'
		AND table_schema = 'public'
	) THEN
		ALTER TABLE "mcp_oauth_session" ADD CONSTRAINT "mcp_oauth_session_state_unique" UNIQUE("state");
	END IF;
EXCEPTION
	WHEN others THEN 
		-- Ignore all errors (constraint might exist with different name)
		NULL;
END $$;