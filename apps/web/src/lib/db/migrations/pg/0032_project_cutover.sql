BEGIN;

LOCK TABLE "archive", "archive_item", "chat_thread" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF to_regclass('public.project') IS NOT NULL THEN
    RAISE EXCEPTION 'Project cutover aborted: table "project" already exists';
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "archive"
  ADD COLUMN "organization_id" text,
  ADD COLUMN "goal" text,
  ADD COLUMN "onboarding_completed_at" timestamp;
--> statement-breakpoint

WITH candidates AS (
  SELECT
    a.id AS project_id,
    m.organization_id,
    row_number() OVER (
      PARTITION BY a.id
      ORDER BY
        CASE
          WHEN COALESCE(o.metadata, '') ~ '"personal"[[:space:]]*:[[:space:]]*true'
          THEN 0
          ELSE 1
        END,
        m.created_at ASC,
        o.id ASC
    ) AS rank
  FROM "archive" a
  JOIN "member" m ON m.user_id = a.user_id
  JOIN "organization" o ON o.id = m.organization_id
)
UPDATE "archive" a
SET "organization_id" = candidates.organization_id
FROM candidates
WHERE candidates.project_id = a.id
  AND candidates.rank = 1;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "archive" WHERE "organization_id" IS NULL) THEN
    RAISE EXCEPTION 'Project cutover aborted: owner without organization membership';
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "archive" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "archive"
  ADD CONSTRAINT "archive_organization_id_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
--> statement-breakpoint

INSERT INTO "project_member" ("project_id", "user_id", "role", "created_at")
SELECT id, user_id, 'owner', CURRENT_TIMESTAMP
FROM "archive"
ON CONFLICT ("project_id", "user_id") DO UPDATE SET role = 'owner';
--> statement-breakpoint

ALTER TABLE "archive" RENAME TO "project";
ALTER TABLE "project" RENAME COLUMN "user_id" TO "owner_user_id";
ALTER TABLE "project" DROP COLUMN IF EXISTS "composio_toolkits";
--> statement-breakpoint

ALTER TABLE "chat_thread" ADD COLUMN IF NOT EXISTS "project_id" uuid;

WITH ranked_items AS (
  SELECT
    ai.item_id AS thread_id,
    ai.archive_id AS project_id,
    row_number() OVER (
      PARTITION BY ai.item_id
      ORDER BY ai.added_at DESC, ai.id DESC
    ) AS rank
  FROM "archive_item" ai
  JOIN "chat_thread" ct ON ct.id = ai.item_id
)
UPDATE "chat_thread" ct
SET "project_id" = ranked_items.project_id
FROM ranked_items
WHERE ranked_items.thread_id = ct.id
  AND ranked_items.rank = 1
  AND ct.project_id IS NULL;
--> statement-breakpoint

DO $$
DECLARE
  fk record;
BEGIN
  FOR fk IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.chat_thread'::regclass
      AND c.contype = 'f'
      AND EXISTS (
        SELECT 1
        FROM unnest(c.conkey) AS key(attnum)
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = key.attnum
        WHERE a.attname = 'project_id'
      )
  LOOP
    EXECUTE format('ALTER TABLE "chat_thread" DROP CONSTRAINT %I', fk.conname);
  END LOOP;
END $$;
--> statement-breakpoint

ALTER TABLE "chat_thread"
  ADD CONSTRAINT "chat_thread_project_id_project_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE SET NULL;

DROP TABLE "archive_item";
--> statement-breakpoint

DO $$
DECLARE
  constraint_row record;
  next_name text;
BEGIN
  FOR constraint_row IN
    SELECT conrelid, conname
    FROM pg_constraint
    WHERE conname LIKE '%archive%'
  LOOP
    next_name := replace(constraint_row.conname, 'archive', 'project');

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = constraint_row.conrelid
        AND conname = next_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE %s RENAME CONSTRAINT %I TO %I',
        constraint_row.conrelid::regclass,
        constraint_row.conname,
        next_name
      );
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint

CREATE INDEX "project_organization_idx" ON "project" ("organization_id");
CREATE INDEX "project_owner_idx" ON "project" ("owner_user_id");
CREATE INDEX IF NOT EXISTS "chat_thread_project_idx" ON "chat_thread" ("project_id");

COMMIT;
