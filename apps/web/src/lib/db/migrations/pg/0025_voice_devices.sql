CREATE TABLE IF NOT EXISTS "voice_device" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" text,
	"device_type" varchar NOT NULL,
	"display_name" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" varchar DEFAULT 'active' NOT NULL,
	"firmware_version" text,
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "voice_device_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "voice_device" ADD CONSTRAINT "voice_device_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_device_user_idx" ON "voice_device" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_device_status_idx" ON "voice_device" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_device_token_hash_idx" ON "voice_device" USING btree ("token_hash");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "voice_device_pairing_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" text,
	"device_type" varchar NOT NULL,
	"display_name" text,
	"code_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "voice_device_pairing_code_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "voice_device_pairing_code" ADD CONSTRAINT "voice_device_pairing_code_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_pairing_user_idx" ON "voice_device_pairing_code" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_pairing_code_hash_idx" ON "voice_device_pairing_code" USING btree ("code_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_pairing_expires_idx" ON "voice_device_pairing_code" USING btree ("expires_at");
