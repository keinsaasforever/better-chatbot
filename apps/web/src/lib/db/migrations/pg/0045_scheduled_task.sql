-- Scheduled agent runs. The table was previously only ever created via
-- `drizzle-kit push` (no migration existed), so on already-pushed databases it
-- is present and this migration must be idempotent: CREATE ... IF NOT EXISTS,
-- ADD COLUMN IF NOT EXISTS, and constraint guards. On a database built purely
-- from the journal it creates the table from scratch.
--
-- The `key` column makes a schedule addressable by name within an agent
-- (unique per agent_id), which is what lets a single agent own multiple named
-- schedules. `next_run_at` is persisted so the cron checker can filter instead
-- of full-scanning, and `last_slot_at` records the cron occurrence a run
-- claimed (distinct from last_run_at, which is the completion time) so a run
-- that overruns its interval does not skip the intervening occurrences.
CREATE TABLE IF NOT EXISTS "scheduled_task" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "task_type" varchar NOT NULL,
  "agent_id" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "cron_expression" text NOT NULL,
  "timezone" text DEFAULT 'UTC' NOT NULL,
  "input_prompt" text,
  "enabled" boolean DEFAULT true,
  "last_run_at" timestamp,
  "last_run_status" varchar,
  "last_run_error" text,
  "last_chat_thread_id" text,
  "run_count" integer DEFAULT 0,
  "success_count" integer DEFAULT 0,
  "failure_count" integer DEFAULT 0,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint

-- Foreign keys (guarded: on a pushed DB the table + constraints already exist).
DO $$ BEGIN
  ALTER TABLE "scheduled_task"
    ADD CONSTRAINT "scheduled_task_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "scheduled_task"
    ADD CONSTRAINT "scheduled_task_agent_id_agent_id_fk"
    FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- New columns for named schedules + persisted due-detection state.
ALTER TABLE "scheduled_task" ADD COLUMN IF NOT EXISTS "key" varchar(64);
--> statement-breakpoint
ALTER TABLE "scheduled_task" ADD COLUMN IF NOT EXISTS "next_run_at" timestamp;
--> statement-breakpoint
ALTER TABLE "scheduled_task" ADD COLUMN IF NOT EXISTS "last_slot_at" timestamp;
--> statement-breakpoint

-- Backfill `key` before the unique index. An agent may already own more than
-- one row (the old UI created one, but the API/voice paths could create more),
-- so a constant default would collide: number the rows per agent, oldest first.
UPDATE "scheduled_task" st SET "key" = sub.k
FROM (
  SELECT id, CASE WHEN rn = 1 THEN 'default' ELSE 'schedule-' || rn END AS k
  FROM (
    SELECT id, row_number() OVER (
      PARTITION BY agent_id ORDER BY created_at NULLS LAST, id
    ) AS rn
    FROM "scheduled_task"
  ) numbered
) sub
WHERE st.id = sub.id AND st."key" IS NULL;
--> statement-breakpoint

ALTER TABLE "scheduled_task" ALTER COLUMN "key" SET DEFAULT 'default';
--> statement-breakpoint
ALTER TABLE "scheduled_task" ALTER COLUMN "key" SET NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "scheduled_task_user_idx" ON "scheduled_task" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_task_agent_idx" ON "scheduled_task" ("agent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_task_enabled_idx" ON "scheduled_task" ("enabled");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "scheduled_task_agent_key_idx" ON "scheduled_task" ("agent_id", "key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_task_due_idx" ON "scheduled_task" ("enabled", "next_run_at");
