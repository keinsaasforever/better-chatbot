-- Rename legacy column from Functions naming to Serverless Containers resource id.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'navigator_workflows'
      AND column_name = 'scaleway_function_id'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'navigator_workflows'
      AND column_name = 'scaleway_container_id'
  ) THEN
    ALTER TABLE "navigator_workflows" RENAME COLUMN "scaleway_function_id" TO "scaleway_container_id";
  END IF;
END $$;
