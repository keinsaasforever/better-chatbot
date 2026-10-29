CREATE TABLE IF NOT EXISTS "agent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" json,
	"user_id" uuid NOT NULL,
	"instructions" json,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "archive" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "archive_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"archive_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint

-- Migrate data from project to agent and archive if project table exists
DO $$ 
BEGIN
	IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'project') 
		AND EXISTS (SELECT FROM information_schema.columns 
                WHERE table_name = 'chat_thread' AND column_name = 'project_id') 
	THEN
		-- 1. Migrate project system prompts to agent table
		INSERT INTO "agent" (id, name, user_id, instructions, created_at, updated_at)
		SELECT 
			id, 
			name, 
			user_id, 
			instructions, 
			created_at, 
			updated_at 
		FROM "project"
		ON CONFLICT (id) DO NOTHING;
		
		-- 2. Create default archives for each project's threads
		INSERT INTO "archive" (id, name, description, user_id, created_at, updated_at)
		SELECT 
			gen_random_uuid(),
			p.name || ' Archive',
			'Migrated from project: ' || p.name,
			p.user_id,
			p.created_at,
			p.updated_at
		FROM "project" p
		WHERE EXISTS (
			SELECT 1 FROM "chat_thread" ct WHERE ct.project_id = p.id
		);
		
		-- 3. Move project threads to archives
		INSERT INTO "archive_item" (id, archive_id, item_id, user_id, added_at)
		SELECT 
			gen_random_uuid(),
			a.id,
			ct.id,
			ct.user_id,
			ct.created_at
		FROM "chat_thread" ct
		JOIN "project" p ON ct.project_id = p.id
		JOIN "archive" a ON a.user_id = p.user_id 
			AND a.name = p.name || ' Archive'
		WHERE ct.project_id IS NOT NULL;
		
		-- 4. Drop project table after migration
		DROP TABLE "project" CASCADE;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "agent" ADD CONSTRAINT "agent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "archive" ADD CONSTRAINT "archive_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "archive_item" ADD CONSTRAINT "archive_item_archive_id_archive_id_fk" FOREIGN KEY ("archive_id") REFERENCES "public"."archive"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "archive_item" ADD CONSTRAINT "archive_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "archive_item_item_id_idx" ON "archive_item" USING btree ("item_id");
--> statement-breakpoint

-- Remove project_id column from chat_thread if it exists
DO $$ 
BEGIN
	IF EXISTS (SELECT 1 FROM information_schema.columns 
			  WHERE table_name = 'chat_thread' AND column_name = 'project_id') THEN
		ALTER TABLE "chat_thread" DROP COLUMN "project_id";
	END IF;
END $$;