-- T1.5: reconcile chat_thread / chat_message indexes with prod.
-- Prod carried indexes added by raw SQL that were never declared in
-- schema.pg.ts (Drizzle drift: a future drizzle-kit generate/push would try to
-- DROP them). They are declared in schema.pg.ts now and (re)created here with
-- IF NOT EXISTS, so this migration is a no-op on prod and creates them on fresh
-- installs. The orphaned duplicate project_id index is dropped.

-- Declared-and-kept indexes (no-op where they already exist on prod).
CREATE INDEX IF NOT EXISTS "chat_message_thread_created_at_idx"
  ON "chat_message" ("thread_id", "created_at");
CREATE INDEX IF NOT EXISTS "chat_thread_project_idx"
  ON "chat_thread" ("project_id");
--> statement-breakpoint

-- New index: thread lookups by owner grow with the table.
CREATE INDEX IF NOT EXISTS "chat_thread_user_id_idx"
  ON "chat_thread" ("user_id");
--> statement-breakpoint

-- Drop the duplicate project_id index. Prod has both "chat_thread_project_idx"
-- (declared in schema, created by 0032) and "idx_chat_thread_project_id"
-- (raw-SQL only, referenced nowhere in the repo). Keep the declared one; drop
-- the orphan so Drizzle never diverges on it.
DROP INDEX IF EXISTS "idx_chat_thread_project_id";
