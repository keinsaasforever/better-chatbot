-- Drop CHECK constraints on the project-brain tables that exist only in the
-- live database.
--
-- The nightly ingest for a project failed on every retry (2026-09-08) with
-- `new row for relation "project_brain_page" violates check constraint
-- "project_brain_page_type_check"` when it tried to store a page of type
-- `topic`. No migration in this repository ever created that constraint
-- (0023 declares the column as a plain varchar), so it was added outside the
-- migration chain and the CI replay never sees it. Its value list predates
-- the newer page types (`topic`, `decision`, `document`, `tool`, `agent`),
-- and any extraction that emits one of them aborts the whole persist
-- transaction.
--
-- Nothing is recreated: allowed values are enforced by the zod schemas before
-- a row is written (`ProjectBrainEntityTypeSchema`, the run stage enum, …),
-- and a database-side list would need a migration on every enum change,
-- which is exactly how this broke. The loop below also removes any other
-- CHECK on these tables for the same reason: none of them come from a
-- migration, so each one is the same kind of drift waiting for the next enum
-- value (e.g. the `consolidating` run stage).
ALTER TABLE "project_brain_page" DROP CONSTRAINT IF EXISTS "project_brain_page_type_check";
--> statement-breakpoint
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS tbl
    FROM pg_constraint c
    WHERE c.contype = 'c'
      AND c.conrelid::regclass::text IN (
        'project_brain_page',
        'project_brain_run',
        'project_brain_event',
        'project_brain_fact',
        'project_brain_link',
        'project_brain_link_evidence',
        'project_brain_raw_source',
        'project_brain_alias',
        'project_brain_page_version',
        'project_brain_content_chunk',
        'project_status_snapshot',
        'project_connected_tool'
      )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, r.conname);
  END LOOP;
END $$;
