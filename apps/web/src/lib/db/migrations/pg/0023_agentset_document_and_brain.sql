-- Ensure pgvector is available for document_embedding (local + Supabase)
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint

-- Base document tables (may exist from manual Supabase setup)
CREATE TABLE IF NOT EXISTS "document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"hash" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_chunk" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"content" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"metadata" json,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_embedding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chunk_id" uuid NOT NULL,
	"embedding" vector(1536),
	"model" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint

-- Agentset document columns
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "source_provider" varchar NOT NULL DEFAULT 'supabase';
--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "source_key" text;
--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "agentset_upload_key" text;
--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "agentset_document_id" text;
--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "agentset_ingest_job_id" text;
--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "agentset_status" varchar NOT NULL DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "agentset_error" text;
--> statement-breakpoint

-- Document FKs and indexes
DO $$ BEGIN
	ALTER TABLE "document" ADD CONSTRAINT "document_project_id_archive_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."archive"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "document" ADD CONSTRAINT "document_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_chunk_document_id_idx" ON "document_chunk" USING btree ("document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_chunk_project_id_idx" ON "document_chunk" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_chunk_user_id_idx" ON "document_chunk" USING btree ("user_id");
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "document_chunk" ADD CONSTRAINT "document_chunk_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "document_chunk" ADD CONSTRAINT "document_chunk_project_id_archive_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."archive"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "document_chunk" ADD CONSTRAINT "document_chunk_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_embedding_chunk_id_idx" ON "document_embedding" USING btree ("chunk_id");
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "document_embedding" ADD CONSTRAINT "document_embedding_chunk_id_document_chunk_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."document_chunk"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embedding_idx" ON "document_embedding" USING hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint

-- Project brain + voice transcript tables
CREATE TABLE IF NOT EXISTS "project_brain_page" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"type" varchar NOT NULL,
	"title" text NOT NULL,
	"compiled_truth" text DEFAULT '' NOT NULL,
	"summary" text,
	"frontmatter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_brain_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"page_id" uuid,
	"user_id" uuid NOT NULL,
	"source_type" varchar NOT NULL,
	"source_id" text NOT NULL,
	"event_date" timestamp NOT NULL,
	"summary" text NOT NULL,
	"detail" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_brain_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"from_page_id" uuid NOT NULL,
	"to_page_id" uuid NOT NULL,
	"link_type" text DEFAULT 'mentions' NOT NULL,
	"context" text,
	"confidence" numeric(4, 3) DEFAULT '1' NOT NULL,
	"source" varchar DEFAULT 'classifier' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "voice_transcript" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"session_id" text NOT NULL,
	"event_id" text NOT NULL,
	"device_id" text,
	"text" text NOT NULL,
	"normalized_text" text,
	"language" text,
	"confidence" numeric(4, 3),
	"intent" varchar DEFAULT 'unknown' NOT NULL,
	"classification" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"action_status" varchar DEFAULT 'stored' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint

-- Project brain FKs
DO $$ BEGIN
	ALTER TABLE "project_brain_page" ADD CONSTRAINT "project_brain_page_project_id_archive_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."archive"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "project_brain_page" ADD CONSTRAINT "project_brain_page_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "project_brain_event" ADD CONSTRAINT "project_brain_event_project_id_archive_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."archive"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "project_brain_event" ADD CONSTRAINT "project_brain_event_page_id_project_brain_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."project_brain_page"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "project_brain_event" ADD CONSTRAINT "project_brain_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "project_brain_link" ADD CONSTRAINT "project_brain_link_project_id_archive_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."archive"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "project_brain_link" ADD CONSTRAINT "project_brain_link_from_page_id_project_brain_page_id_fk" FOREIGN KEY ("from_page_id") REFERENCES "public"."project_brain_page"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "project_brain_link" ADD CONSTRAINT "project_brain_link_to_page_id_project_brain_page_id_fk" FOREIGN KEY ("to_page_id") REFERENCES "public"."project_brain_page"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "voice_transcript" ADD CONSTRAINT "voice_transcript_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "voice_transcript" ADD CONSTRAINT "voice_transcript_project_id_archive_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."archive"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Project brain indexes and uniques
DO $$ BEGIN
	ALTER TABLE "project_brain_page" ADD CONSTRAINT "project_brain_page_project_slug_unique" UNIQUE ("project_id","slug");
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_brain_page_project_idx" ON "project_brain_page" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_brain_page_user_idx" ON "project_brain_page" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_brain_event_project_date_idx" ON "project_brain_event" USING btree ("project_id","event_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_brain_event_source_idx" ON "project_brain_event" USING btree ("source_type","source_id");
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "project_brain_link" ADD CONSTRAINT "project_brain_link_unique" UNIQUE ("project_id","from_page_id","to_page_id","link_type");
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_brain_link_from_idx" ON "project_brain_link" USING btree ("from_page_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_brain_link_to_idx" ON "project_brain_link" USING btree ("to_page_id");
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "voice_transcript" ADD CONSTRAINT "voice_transcript_user_session_event_unique" UNIQUE ("user_id","session_id","event_id");
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_transcript_project_idx" ON "voice_transcript" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_transcript_user_created_idx" ON "voice_transcript" USING btree ("user_id","created_at");
