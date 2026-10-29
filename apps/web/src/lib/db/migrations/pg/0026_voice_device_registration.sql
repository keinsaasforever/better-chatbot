CREATE TABLE IF NOT EXISTS "voice_device_registration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"device_type" varchar NOT NULL,
	"firmware_version" text,
	"hardware_id" text,
	"display_name" text,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"user_id" uuid,
	"organization_id" text,
	"device_id" uuid,
	"delivery_token" text,
	"expires_at" timestamp NOT NULL,
	"claimed_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "voice_device_registration_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "voice_device_registration" ADD CONSTRAINT "voice_device_registration_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "voice_device_registration" ADD CONSTRAINT "voice_device_registration_device_id_voice_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."voice_device"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_registration_status_idx" ON "voice_device_registration" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_registration_expires_idx" ON "voice_device_registration" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_registration_user_idx" ON "voice_device_registration" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_registration_device_idx" ON "voice_device_registration" USING btree ("device_id");
