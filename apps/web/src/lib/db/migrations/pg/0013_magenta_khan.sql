-- Add user ownership and visibility to MCP servers
ALTER TABLE "mcp_server" ADD COLUMN IF NOT EXISTS "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "mcp_server"
ADD COLUMN IF NOT EXISTS "visibility" varchar DEFAULT 'private' NOT NULL;
--> statement-breakpoint

-- Add foreign key constraint for user_id
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE c.conname = 'mcp_server_user_id_user_id_fk'
          AND t.relname = 'mcp_server'
          AND n.nspname = 'public'
    ) THEN
        ALTER TABLE "mcp_server"
        ADD CONSTRAINT "mcp_server_user_id_user_id_fk" 
        FOREIGN KEY ("user_id") REFERENCES "public"."user" ("id") 
        ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;
END
$$;
--> statement-breakpoint

-- Migrate existing data: set existing servers without user_id to public visibility
-- This preserves existing functionality where all servers were accessible to everyone
UPDATE "mcp_server"
SET "visibility" = 'public'
WHERE "user_id" IS NULL;
--> statement-breakpoint
