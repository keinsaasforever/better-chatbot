DO $$ BEGIN
ALTER TABLE "user" ADD COLUMN "preferences" json DEFAULT '{}'::json;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;
--> statement-breakpoint

