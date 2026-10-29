ALTER TABLE "archive" ADD COLUMN IF NOT EXISTS "system_prompt" text;--> statement-breakpoint
ALTER TABLE "archive" ADD COLUMN IF NOT EXISTS "composio_toolkits" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_widget" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "kind" varchar NOT NULL,
  "title" text NOT NULL,
  "html" text NOT NULL,
  "render_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "slot" text DEFAULT 'default' NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "generated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "project_widget_slot_unique" UNIQUE("project_id","slot")
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_widget" ADD CONSTRAINT "project_widget_project_id_archive_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."archive"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_widget" ADD CONSTRAINT "project_widget_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_widget_project_idx" ON "project_widget" USING btree ("project_id");
