ALTER TABLE "chat_message" ADD COLUMN IF NOT EXISTS "metadata" json;--> statement-breakpoint

-- Migrate existing model and usage data to metadata format BEFORE dropping columns
DO $$ 
BEGIN
	-- Migrate model data if model column exists
	IF EXISTS (SELECT 1 FROM information_schema.columns 
		  WHERE table_name = 'chat_message' AND column_name = 'model') THEN
		
		BEGIN
		-- Migrate model data to metadata.chatModel.model for all message types that have model data
		UPDATE "chat_message" 
		SET "metadata" = COALESCE("metadata", '{}')::jsonb || 
			json_build_object('chatModel', json_build_object('model', "model"))::jsonb
		WHERE "model" IS NOT NULL 
		AND TRIM("model") != ''
		AND ("metadata" IS NULL OR "metadata"->>'chatModel' IS NULL);
			
			RAISE NOTICE 'Migrated % messages with model data to metadata format', 
				(SELECT COUNT(*) FROM "chat_message" 
				 WHERE "model" IS NOT NULL AND TRIM("model") != '');
		EXCEPTION
			WHEN OTHERS THEN
				RAISE NOTICE 'Skipped model migration due to error: %', SQLERRM;
		END;
	END IF;

	-- Migrate usage data from annotations if annotations column exists
	IF EXISTS (SELECT 1 FROM information_schema.columns 
		  WHERE table_name = 'chat_message' AND column_name = 'annotations') THEN
		
		BEGIN
		-- Migrate usage tokens from annotations[1]->usageTokens to metadata.usage.totalTokens
		UPDATE "chat_message" 
		SET "metadata" = COALESCE("metadata", '{}')::jsonb || 
			json_build_object('usage', json_build_object('totalTokens', 
				CASE 
					WHEN ("annotations"[1]::json->>'usageTokens') ~ '^[0-9]+(\.[0-9]+)?$' 
					THEN ("annotations"[1]::json->>'usageTokens')::numeric
					ELSE 0
				END))::jsonb
		WHERE "annotations" IS NOT NULL 
		AND array_length("annotations", 1) >= 1
		AND "annotations"[1] IS NOT NULL
		AND "annotations"[1]::text != 'null'
		AND "annotations"[1]::jsonb ? 'usageTokens'
		AND ("metadata" IS NULL OR "metadata"->>'usage' IS NULL);
			
			RAISE NOTICE 'Migrated % messages with usage data from annotations to metadata format', 
				(SELECT COUNT(*) FROM "chat_message" 
				 WHERE "annotations" IS NOT NULL 
				 AND array_length("annotations", 1) >= 1
				 AND "annotations"[1] IS NOT NULL
				 AND "annotations"[1]::text != 'null'
				 AND "annotations"[1]::jsonb ? 'usageTokens');
		EXCEPTION
			WHEN OTHERS THEN
				RAISE NOTICE 'Skipped annotations migration due to error: %', SQLERRM;
		END;
	END IF;
END $$;
--> statement-breakpoint

-- Now safely drop the old columns after data migration
DO $$ 
BEGIN
	IF EXISTS (SELECT 1 FROM information_schema.columns 
		  WHERE table_name = 'chat_message' AND column_name = 'attachments') THEN
		ALTER TABLE "chat_message" DROP COLUMN "attachments";
	END IF;
END $$;
--> statement-breakpoint
DO $$ 
BEGIN
	IF EXISTS (SELECT 1 FROM information_schema.columns 
		  WHERE table_name = 'chat_message' AND column_name = 'annotations') THEN
		ALTER TABLE "chat_message" DROP COLUMN "annotations";
	END IF;
END $$;
--> statement-breakpoint
DO $$ 
BEGIN
	IF EXISTS (SELECT 1 FROM information_schema.columns 
		  WHERE table_name = 'chat_message' AND column_name = 'model') THEN
		ALTER TABLE "chat_message" DROP COLUMN "model";
	END IF;
END $$;