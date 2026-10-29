ALTER TABLE "navigator_workflows"
  ADD COLUMN IF NOT EXISTS "user_input_raw" text,
  ADD COLUMN IF NOT EXISTS "user_input_file_name" text,
  ADD COLUMN IF NOT EXISTS "user_input_description" text;
