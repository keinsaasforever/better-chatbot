ALTER TABLE "project_connected_tool"
  RENAME COLUMN "user_id" TO "credential_owner_user_id";
--> statement-breakpoint

ALTER TABLE "project_connected_tool"
  ADD COLUMN "connection_ref" text;

UPDATE "project_connected_tool"
SET "connection_ref" = "provider_ref"
WHERE "provider_type" = 'mcp';

UPDATE "project_connected_tool"
SET
  "status" = 'needs_auth',
  "last_sync_error" = 'Reconnect required to bind a verified connected account.'
WHERE "provider_type" = 'composio'
  AND "connection_ref" IS NULL;
--> statement-breakpoint

ALTER TABLE "project_connected_tool"
  DROP CONSTRAINT IF EXISTS "project_connected_tool_unique";

ALTER TABLE "project_connected_tool"
  ADD CONSTRAINT "project_connected_tool_identity_unique"
  UNIQUE ("project_id", "provider_type", "connection_ref", "tool_name");
--> statement-breakpoint

CREATE TABLE "project_brain_run" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "actor_user_id" uuid NOT NULL,
  "source_user_id" uuid NOT NULL,
  "connected_tool_id" uuid,
  "source_type" varchar NOT NULL,
  "source_ref" text NOT NULL,
  "source_scope" text NOT NULL,
  "trigger" varchar NOT NULL,
  "full_snapshot" boolean DEFAULT true NOT NULL,
  "idempotency_key" text NOT NULL,
  "status" varchar DEFAULT 'queued' NOT NULL,
  "stage" varchar DEFAULT 'queued' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error_code" text,
  "error_message" text,
  "enqueued_at" timestamp,
  "started_at" timestamp,
  "finished_at" timestamp,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "project_brain_run_idempotency_unique"
    UNIQUE ("project_id", "idempotency_key")
);
--> statement-breakpoint

ALTER TABLE "project_brain_run"
  ADD CONSTRAINT "project_brain_run_project_id_project_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;
ALTER TABLE "project_brain_run"
  ADD CONSTRAINT "project_brain_run_actor_user_id_user_id_fk"
  FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE CASCADE;
ALTER TABLE "project_brain_run"
  ADD CONSTRAINT "project_brain_run_source_user_id_user_id_fk"
  FOREIGN KEY ("source_user_id") REFERENCES "user"("id") ON DELETE CASCADE;
ALTER TABLE "project_brain_run"
  ADD CONSTRAINT "project_brain_run_connected_tool_id_project_connected_tool_id_fk"
  FOREIGN KEY ("connected_tool_id") REFERENCES "project_connected_tool"("id") ON DELETE SET NULL;

CREATE INDEX "project_brain_run_project_created_idx"
  ON "project_brain_run" ("project_id", "created_at");
CREATE INDEX "project_brain_run_status_idx"
  ON "project_brain_run" ("status");
--> statement-breakpoint

ALTER TABLE "project_brain_raw_source"
  RENAME COLUMN "user_id" TO "source_user_id";
ALTER TABLE "project_brain_raw_source"
  ADD COLUMN "run_id" uuid,
  ADD COLUMN "source_scope" text NOT NULL DEFAULT 'legacy',
  ADD COLUMN "content_hash" text NOT NULL DEFAULT 'legacy';
ALTER TABLE "project_brain_raw_source"
  ADD CONSTRAINT "project_brain_raw_source_run_id_project_brain_run_id_fk"
  FOREIGN KEY ("run_id") REFERENCES "project_brain_run"("id") ON DELETE SET NULL;
ALTER TABLE "project_brain_raw_source"
  DROP CONSTRAINT IF EXISTS "project_brain_raw_source_unique";
ALTER TABLE "project_brain_raw_source"
  ADD CONSTRAINT "project_brain_raw_source_version_unique"
  UNIQUE ("project_id", "source_type", "source_ref", "content_hash");
--> statement-breakpoint

CREATE TABLE "project_brain_alias" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "page_id" uuid NOT NULL,
  "entity_type" varchar NOT NULL,
  "alias" text NOT NULL,
  "normalized_alias" text NOT NULL,
  "source" varchar DEFAULT 'extracted' NOT NULL,
  "created_by_source_id" uuid,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "project_brain_alias_identity_unique"
    UNIQUE ("project_id", "entity_type", "normalized_alias")
);
ALTER TABLE "project_brain_alias"
  ADD CONSTRAINT "project_brain_alias_project_id_project_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;
ALTER TABLE "project_brain_alias"
  ADD CONSTRAINT "project_brain_alias_page_id_project_brain_page_id_fk"
  FOREIGN KEY ("page_id") REFERENCES "project_brain_page"("id") ON DELETE CASCADE;
ALTER TABLE "project_brain_alias"
  ADD CONSTRAINT "project_brain_alias_created_by_source_id_project_brain_raw_source_id_fk"
  FOREIGN KEY ("created_by_source_id") REFERENCES "project_brain_raw_source"("id") ON DELETE SET NULL;
CREATE INDEX "project_brain_alias_page_idx" ON "project_brain_alias" ("page_id");
--> statement-breakpoint

CREATE TABLE "project_brain_fact" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "page_id" uuid NOT NULL,
  "source_scope" text NOT NULL,
  "fact_type" varchar NOT NULL,
  "fact_key" text NOT NULL,
  "value" text NOT NULL,
  "value_hash" text NOT NULL,
  "status" varchar DEFAULT 'current' NOT NULL,
  "confidence" numeric(4, 3) DEFAULT '1' NOT NULL,
  "first_source_id" uuid,
  "last_source_id" uuid,
  "last_run_id" uuid,
  "first_observed_at" timestamp NOT NULL,
  "last_observed_at" timestamp NOT NULL,
  "superseded_at" timestamp,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "project_brain_fact_value_unique"
    UNIQUE ("page_id", "source_scope", "fact_key", "value_hash")
);
ALTER TABLE "project_brain_fact"
  ADD CONSTRAINT "project_brain_fact_project_id_project_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;
ALTER TABLE "project_brain_fact"
  ADD CONSTRAINT "project_brain_fact_page_id_project_brain_page_id_fk"
  FOREIGN KEY ("page_id") REFERENCES "project_brain_page"("id") ON DELETE CASCADE;
ALTER TABLE "project_brain_fact"
  ADD CONSTRAINT "project_brain_fact_first_source_id_project_brain_raw_source_id_fk"
  FOREIGN KEY ("first_source_id") REFERENCES "project_brain_raw_source"("id") ON DELETE SET NULL;
ALTER TABLE "project_brain_fact"
  ADD CONSTRAINT "project_brain_fact_last_source_id_project_brain_raw_source_id_fk"
  FOREIGN KEY ("last_source_id") REFERENCES "project_brain_raw_source"("id") ON DELETE SET NULL;
ALTER TABLE "project_brain_fact"
  ADD CONSTRAINT "project_brain_fact_last_run_id_project_brain_run_id_fk"
  FOREIGN KEY ("last_run_id") REFERENCES "project_brain_run"("id") ON DELETE SET NULL;
CREATE INDEX "project_brain_fact_project_status_idx"
  ON "project_brain_fact" ("project_id", "status");
--> statement-breakpoint

CREATE TABLE "project_brain_link_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "link_id" uuid NOT NULL,
  "source_id" uuid NOT NULL,
  "run_id" uuid,
  "source_scope" text NOT NULL,
  "evidence_key" text NOT NULL,
  "context" text,
  "status" varchar DEFAULT 'current' NOT NULL,
  "confidence" numeric(4, 3) DEFAULT '1' NOT NULL,
  "observed_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "project_brain_link_evidence_unique"
    UNIQUE ("link_id", "source_scope", "evidence_key")
);
ALTER TABLE "project_brain_link_evidence"
  ADD CONSTRAINT "project_brain_link_evidence_project_id_project_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;
ALTER TABLE "project_brain_link_evidence"
  ADD CONSTRAINT "project_brain_link_evidence_link_id_project_brain_link_id_fk"
  FOREIGN KEY ("link_id") REFERENCES "project_brain_link"("id") ON DELETE CASCADE;
ALTER TABLE "project_brain_link_evidence"
  ADD CONSTRAINT "project_brain_link_evidence_source_id_project_brain_raw_source_id_fk"
  FOREIGN KEY ("source_id") REFERENCES "project_brain_raw_source"("id") ON DELETE CASCADE;
ALTER TABLE "project_brain_link_evidence"
  ADD CONSTRAINT "project_brain_link_evidence_run_id_project_brain_run_id_fk"
  FOREIGN KEY ("run_id") REFERENCES "project_brain_run"("id") ON DELETE SET NULL;
--> statement-breakpoint

ALTER TABLE "project_widget"
  ADD COLUMN "source_scope" text NOT NULL DEFAULT 'legacy',
  ADD COLUMN "source_run_id" uuid,
  ADD COLUMN "stale_at" timestamp;
ALTER TABLE "project_widget"
  ADD CONSTRAINT "project_widget_source_run_id_project_brain_run_id_fk"
  FOREIGN KEY ("source_run_id") REFERENCES "project_brain_run"("id") ON DELETE SET NULL;
ALTER TABLE "project_widget" DROP COLUMN "html";
ALTER TABLE "project_widget"
  DROP CONSTRAINT IF EXISTS "project_widget_slot_unique";
ALTER TABLE "project_widget"
  ADD CONSTRAINT "project_widget_scope_slot_unique"
  UNIQUE ("project_id", "source_scope", "slot");
