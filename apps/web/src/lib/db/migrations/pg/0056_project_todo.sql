-- Project-level status and to-dos.
--
-- The project Overview used to render one `project_widget` row per source
-- scope and slot, so two connected tools produced two "To-dos" and two
-- "Status" cards, and every card was overwritten on the next sync. This
-- migration adds the storage for a single consolidated view per project:
--
--   * `project_todo`: one row per actionable item, keyed by an LLM-stable
--     `key` so the same task seen in two tools stays one row. `status` is
--     owned by the user (done / dismissed survive later syncs);
--     `notified_at` + `notified_run_id` make the "notify once" rule and the
--     Inngest step replay both safe.
--   * `project_brain_raw_source.extraction_signals`: the per-source
--     summary / status / todos the extraction step already produced, kept so
--     the consolidation step can merge sources without re-reading raw text.
--   * `project_status_snapshot.run_id`: lets the consolidation step insert
--     its snapshot idempotently (one per ingest run) and pick the previous
--     snapshot as the health baseline.
--   * `notification.url` / `notification.dedupe_key`: the bell can deep-link
--     to a project, and a replayed notify step cannot insert the same digest
--     twice for the same user.
CREATE TABLE IF NOT EXISTS "project_todo" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "project"("id") ON DELETE cascade,
  "key" varchar(80) NOT NULL,
  "title" text NOT NULL,
  "detail" text,
  "priority" varchar(16) DEFAULT 'normal' NOT NULL,
  "due_at" timestamp,
  "source_scope" text,
  "source_label" text,
  "source_url" text,
  "status" varchar(16) DEFAULT 'open' NOT NULL,
  "notified_at" timestamp,
  "notified_run_id" uuid,
  "last_seen_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "resolved_at" timestamp,
  "resolved_by_user_id" uuid REFERENCES "user"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_todo_project_key_idx" ON "project_todo" ("project_id", "key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_todo_project_status_idx" ON "project_todo" ("project_id", "status");
--> statement-breakpoint
ALTER TABLE "project_brain_raw_source" ADD COLUMN IF NOT EXISTS "extraction_signals" jsonb;
--> statement-breakpoint
ALTER TABLE "project_status_snapshot" ADD COLUMN IF NOT EXISTS "run_id" uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_status_snapshot_run_idx" ON "project_status_snapshot" ("run_id") WHERE "run_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN IF NOT EXISTS "url" text;
--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN IF NOT EXISTS "dedupe_key" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notification_user_dedupe_idx" ON "notification" ("user_id", "dedupe_key") WHERE "dedupe_key" IS NOT NULL;
