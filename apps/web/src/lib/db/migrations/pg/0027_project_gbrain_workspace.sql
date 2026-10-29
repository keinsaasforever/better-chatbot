CREATE TABLE IF NOT EXISTS "project_brain_raw_source" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "source_type" varchar NOT NULL,
  "source_ref" text NOT NULL,
  "title" text,
  "text_content" text,
  "summary" text,
  "raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "observed_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_brain_page_version" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "page_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "compiled_truth" text DEFAULT '' NOT NULL,
  "summary" text,
  "frontmatter" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "source_id" uuid,
  "snapshot_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_brain_content_chunk" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "page_id" uuid,
  "source_id" uuid,
  "user_id" uuid NOT NULL,
  "chunk_type" varchar NOT NULL,
  "content" text NOT NULL,
  "chunk_index" integer DEFAULT 0 NOT NULL,
  "embedding" vector(1536),
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_connected_tool" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "provider_type" varchar NOT NULL,
  "provider_ref" text NOT NULL,
  "tool_name" text NOT NULL,
  "display_name" text NOT NULL,
  "status" varchar DEFAULT 'connected' NOT NULL,
  "sync_enabled" boolean DEFAULT true NOT NULL,
  "sync_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_sync_at" timestamp,
  "last_sync_error" text,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_status_snapshot" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "todos_html" text,
  "status_html" text,
  "todos_render_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status_render_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "summary" text,
  "health" varchar DEFAULT 'unknown' NOT NULL,
  "generated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_member" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" varchar DEFAULT 'viewer' NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_agent" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "agent_id" uuid NOT NULL,
  "added_by" uuid,
  "status" varchar DEFAULT 'active' NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "project_brain_raw_source" ADD CONSTRAINT "project_brain_raw_source_project_fk" FOREIGN KEY ("project_id") REFERENCES "public"."archive"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_brain_raw_source" ADD CONSTRAINT "project_brain_raw_source_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_brain_page_version" ADD CONSTRAINT "project_brain_page_version_page_fk" FOREIGN KEY ("page_id") REFERENCES "public"."project_brain_page"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_brain_page_version" ADD CONSTRAINT "project_brain_page_version_project_fk" FOREIGN KEY ("project_id") REFERENCES "public"."archive"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_brain_page_version" ADD CONSTRAINT "project_brain_page_version_source_fk" FOREIGN KEY ("source_id") REFERENCES "public"."project_brain_raw_source"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_brain_content_chunk" ADD CONSTRAINT "project_brain_content_chunk_project_fk" FOREIGN KEY ("project_id") REFERENCES "public"."archive"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_brain_content_chunk" ADD CONSTRAINT "project_brain_content_chunk_page_fk" FOREIGN KEY ("page_id") REFERENCES "public"."project_brain_page"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_brain_content_chunk" ADD CONSTRAINT "project_brain_content_chunk_source_fk" FOREIGN KEY ("source_id") REFERENCES "public"."project_brain_raw_source"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_brain_content_chunk" ADD CONSTRAINT "project_brain_content_chunk_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_connected_tool" ADD CONSTRAINT "project_connected_tool_project_fk" FOREIGN KEY ("project_id") REFERENCES "public"."archive"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_connected_tool" ADD CONSTRAINT "project_connected_tool_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_status_snapshot" ADD CONSTRAINT "project_status_snapshot_project_fk" FOREIGN KEY ("project_id") REFERENCES "public"."archive"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_status_snapshot" ADD CONSTRAINT "project_status_snapshot_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_member" ADD CONSTRAINT "project_member_project_fk" FOREIGN KEY ("project_id") REFERENCES "public"."archive"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_member" ADD CONSTRAINT "project_member_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_agent" ADD CONSTRAINT "project_agent_project_fk" FOREIGN KEY ("project_id") REFERENCES "public"."archive"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_agent" ADD CONSTRAINT "project_agent_agent_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_agent" ADD CONSTRAINT "project_agent_added_by_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "project_brain_raw_source" ADD CONSTRAINT "project_brain_raw_source_unique" UNIQUE ("project_id","source_type","source_ref");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_connected_tool" ADD CONSTRAINT "project_connected_tool_unique" UNIQUE ("project_id","provider_type","provider_ref","tool_name");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_member" ADD CONSTRAINT "project_member_unique" UNIQUE ("project_id","user_id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_agent" ADD CONSTRAINT "project_agent_unique" UNIQUE ("project_id","agent_id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "project_brain_raw_source_project_idx" ON "project_brain_raw_source" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_brain_raw_source_observed_idx" ON "project_brain_raw_source" USING btree ("observed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_brain_page_version_page_idx" ON "project_brain_page_version" USING btree ("page_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_brain_page_version_project_idx" ON "project_brain_page_version" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_brain_chunk_project_idx" ON "project_brain_content_chunk" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_brain_chunk_page_idx" ON "project_brain_content_chunk" USING btree ("page_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_brain_chunk_source_idx" ON "project_brain_content_chunk" USING btree ("source_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_brain_chunk_embedding_idx" ON "project_brain_content_chunk" USING hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_brain_chunk_fts_idx" ON "project_brain_content_chunk" USING gin (to_tsvector('simple', content));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_connected_tool_project_idx" ON "project_connected_tool" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_status_snapshot_project_idx" ON "project_status_snapshot" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_status_snapshot_generated_idx" ON "project_status_snapshot" USING btree ("generated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_member_project_idx" ON "project_member" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_member_user_idx" ON "project_member" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_agent_project_idx" ON "project_agent" USING btree ("project_id");
