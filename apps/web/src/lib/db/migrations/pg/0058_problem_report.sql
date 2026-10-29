-- In-product problem reports ("Report an issue").
--
-- The sidebar entry used to be a `mailto:` link, so a report only existed in
-- someone's inbox: nothing queryable, no screenshots, no link back to the
-- telemetry of the session that produced it. This table is the durable record
-- behind the new dialog. The same submission also emits an ERROR-severity
-- span/log so Superlog groups it into an incident, and sends a notification
-- mail — both are best-effort side effects, the row is the source of truth.
--
--   * `description` is the user's own text (typed or dictated), so it is the
--     one field that is always present.
--   * `screenshots` is a jsonb array of `{ key, url, name, contentType, size }`
--     objects already uploaded through /api/storage/upload. Kept denormalised:
--     attachments are only ever read back with their report.
--   * `context` carries page URL / user agent / locale — the "what were you
--     looking at" that users never think to include.
--   * `trace_id` is the OTel trace of the submission, which is what links a row
--     to the incident Superlog raised for it.
CREATE TABLE IF NOT EXISTS "problem_report" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "organization_id" text REFERENCES "organization"("id") ON DELETE set null,
  "description" text NOT NULL,
  "screenshots" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "context" jsonb,
  "trace_id" varchar(32),
  "status" varchar(16) DEFAULT 'open' NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "problem_report_user_created_idx" ON "problem_report" ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "problem_report_org_created_idx" ON "problem_report" ("organization_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "problem_report_status_created_idx" ON "problem_report" ("status", "created_at");
