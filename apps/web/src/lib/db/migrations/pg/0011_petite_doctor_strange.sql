CREATE TABLE IF NOT EXISTS "bookmark" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"item_type" varchar NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "bookmark_user_id_item_id_item_type_unique" UNIQUE("user_id","item_id","item_type")
);
--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "visibility" varchar DEFAULT 'private' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "bookmark" ADD CONSTRAINT "bookmark_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookmark_user_id_idx" ON "bookmark" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookmark_item_idx" ON "bookmark" USING btree ("item_id","item_type");