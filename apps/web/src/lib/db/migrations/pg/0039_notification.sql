-- In-app notifications (header bell): background events such as scheduled
-- agent runs finishing or failing. thread_id/agent_id are intentionally not
-- foreign keys so notification history survives thread/agent deletion; the
-- client handles dead links gracefully.
CREATE TABLE IF NOT EXISTS "notification" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "type" varchar(40) NOT NULL,
  "title" text NOT NULL,
  "body" text,
  "thread_id" uuid,
  "agent_id" uuid,
  "read_at" timestamp,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS "notification_user_read_idx" ON "notification" ("user_id","read_at");
CREATE INDEX IF NOT EXISTS "notification_user_created_idx" ON "notification" ("user_id","created_at");
