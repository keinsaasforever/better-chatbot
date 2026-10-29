CREATE TABLE IF NOT EXISTS "voice_session" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "organization_id" text,
  "billing_customer_id" text NOT NULL,
  "device_id" uuid REFERENCES "voice_device"("id") ON DELETE set null,
  "mode" varchar NOT NULL DEFAULT 'voice_command',
  "status" varchar NOT NULL DEFAULT 'active',
  "session_id" text NOT NULL,
  "gateway_instance_id" text,
  "device_connection_id" text,
  "provider" text,
  "started_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at" timestamp,
  "duration_seconds" integer,
  "audio_seconds" integer,
  "billed_assemblyai_seconds" integer NOT NULL DEFAULT 0,
  "last_audio_at" timestamp,
  "last_segment_at" timestamp,
  "last_heartbeat_at" timestamp,
  "transcript_text" text,
  "segment_count" integer NOT NULL DEFAULT 0,
  "analysis_status" varchar NOT NULL DEFAULT 'pending',
  "analysis_result" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "target_type" varchar,
  "target_id" text,
  "project_id" uuid REFERENCES "archive"("id") ON DELETE set null,
  "created_thread_id" text,
  "created_workflow_id" text,
  "created_agent_id" text,
  "created_scheduled_task_id" text,
  "interrupt_reason" text,
  "finalize_reason" text,
  "finalize_requested_at" timestamp,
  "finalized_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "voice_session_device_session_unique" ON "voice_session" ("device_id", "session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_session_user_created_idx" ON "voice_session" ("user_id", "started_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_session_device_status_idx" ON "voice_session" ("device_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "voice_transcript_provider_connection" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "voice_session_id" uuid NOT NULL REFERENCES "voice_session"("id") ON DELETE cascade,
  "provider" varchar NOT NULL,
  "provider_connection_id" text NOT NULL,
  "status" varchar NOT NULL DEFAULT 'active',
  "sequence_start" integer,
  "sequence_end" integer,
  "started_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at" timestamp,
  "close_reason" text,
  "last_provider_event_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "voice_provider_connection_unique" ON "voice_transcript_provider_connection" ("voice_session_id", "provider_connection_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_provider_connection_session_idx" ON "voice_transcript_provider_connection" ("voice_session_id", "started_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "voice_transcript_segment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "voice_session_id" uuid NOT NULL REFERENCES "voice_session"("id") ON DELETE cascade,
  "provider_connection_id" uuid REFERENCES "voice_transcript_provider_connection"("id") ON DELETE set null,
  "sequence_number" integer NOT NULL,
  "idempotency_key" text NOT NULL,
  "provider_segment_id" text,
  "start_ms" integer,
  "end_ms" integer,
  "text" text NOT NULL,
  "is_final" boolean NOT NULL DEFAULT true,
  "language" text,
  "confidence" numeric(4,3),
  "provider_payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "voice_segment_session_sequence_unique" ON "voice_transcript_segment" ("voice_session_id", "sequence_number");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "voice_segment_idempotency_unique" ON "voice_transcript_segment" ("voice_session_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_segment_session_created_idx" ON "voice_transcript_segment" ("voice_session_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "voice_usage_event" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "voice_session_id" uuid NOT NULL REFERENCES "voice_session"("id") ON DELETE cascade,
  "billing_customer_id" text NOT NULL,
  "feature_id" text NOT NULL,
  "quantity" integer NOT NULL,
  "idempotency_key" text NOT NULL,
  "status" varchar NOT NULL DEFAULT 'pending',
  "error" text,
  "tracked_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "voice_usage_event_idempotency_unique" ON "voice_usage_event" ("idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_usage_event_session_idx" ON "voice_usage_event" ("voice_session_id");
