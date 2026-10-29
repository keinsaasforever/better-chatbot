-- T0.12: organization-scope shared MCP servers, agents, and workflows.
-- "public"/"readonly" resources previously leaked across every org on the
-- instance. Add a nullable organization_id (FK, ON DELETE CASCADE) so the
-- shared-read predicate can require an org match. Nullable is deliberate: an
-- org-less row can never satisfy the org predicate, so it fails closed and
-- stays owner-only rather than becoming cross-tenant visible.
ALTER TABLE "mcp_server" ADD COLUMN IF NOT EXISTS "organization_id" text;
ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "organization_id" text;
ALTER TABLE "workflow" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint

ALTER TABLE "mcp_server"
  ADD CONSTRAINT "mcp_server_organization_id_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;
ALTER TABLE "agent"
  ADD CONSTRAINT "agent_organization_id_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;
ALTER TABLE "workflow"
  ADD CONSTRAINT "workflow_organization_id_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "mcp_server_organization_id_idx" ON "mcp_server" ("organization_id");
CREATE INDEX IF NOT EXISTS "agent_organization_id_idx" ON "agent" ("organization_id");
CREATE INDEX IF NOT EXISTS "workflow_organization_id_idx" ON "workflow" ("organization_id");
--> statement-breakpoint

-- Backfill from the owner's OLDEST membership. Every regular user belongs to
-- exactly one org; only the three internal superadmins are multi-org, for whom
-- oldest membership = primary org (low stakes). Owners with no membership stay
-- NULL and remain owner-only (fail closed).
UPDATE "mcp_server" AS t
SET "organization_id" = (
  SELECT m."organization_id"
  FROM "member" m
  WHERE m."user_id" = t."user_id"
  ORDER BY m."created_at" ASC
  LIMIT 1
)
WHERE t."organization_id" IS NULL;

UPDATE "agent" AS t
SET "organization_id" = (
  SELECT m."organization_id"
  FROM "member" m
  WHERE m."user_id" = t."user_id"
  ORDER BY m."created_at" ASC
  LIMIT 1
)
WHERE t."organization_id" IS NULL;

UPDATE "workflow" AS t
SET "organization_id" = (
  SELECT m."organization_id"
  FROM "member" m
  WHERE m."user_id" = t."user_id"
  ORDER BY m."created_at" ASC
  LIMIT 1
)
WHERE t."organization_id" IS NULL;
