CREATE TABLE IF NOT EXISTS "chat_export_comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"export_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"parent_id" uuid,
	"content" json NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_export" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"exporter_id" uuid NOT NULL,
	"original_thread_id" uuid,
	"messages" json NOT NULL,
	"exported_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"expires_at" timestamp
);


--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "chat_export_comment" ADD CONSTRAINT "chat_export_comment_export_id_chat_export_id_fk" FOREIGN KEY ("export_id") REFERENCES "public"."chat_export"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "chat_export_comment" ADD CONSTRAINT "chat_export_comment_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "chat_export_comment" ADD CONSTRAINT "chat_export_comment_parent_id_chat_export_comment_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."chat_export_comment"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "chat_export" ADD CONSTRAINT "chat_export_exporter_id_user_id_fk" FOREIGN KEY ("exporter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
