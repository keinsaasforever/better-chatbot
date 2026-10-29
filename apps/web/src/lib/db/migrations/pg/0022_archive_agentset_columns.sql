-- Agentset + project settings columns on archive (projects)
ALTER TABLE "archive" ADD COLUMN IF NOT EXISTS "embedding_model" text NOT NULL DEFAULT 'text-embedding-3-small';
--> statement-breakpoint
ALTER TABLE "archive" ADD COLUMN IF NOT EXISTS "agentset_namespace_id" text;
--> statement-breakpoint
ALTER TABLE "archive" ADD COLUMN IF NOT EXISTS "agentset_embedding_profile" text NOT NULL DEFAULT 'agentset-managed';
--> statement-breakpoint
ALTER TABLE "archive" ADD COLUMN IF NOT EXISTS "agentset_embedding_config" jsonb;
--> statement-breakpoint
ALTER TABLE "archive" ADD COLUMN IF NOT EXISTS "retrieval_backend" varchar NOT NULL DEFAULT 'hybrid';
--> statement-breakpoint
ALTER TABLE "archive" ADD COLUMN IF NOT EXISTS "memory_enabled" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "archive" ADD COLUMN IF NOT EXISTS "voice_enabled" boolean NOT NULL DEFAULT true;
