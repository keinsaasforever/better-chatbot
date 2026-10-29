-- Vercel Agent Skills: saved SKILL.md instruction bundles a user imports from
-- the skills.sh library. Mirrors the agent table's ownership + org-scope +
-- visibility shape so shared ("public"/"readonly") skills are only visible
-- within the owner's active organization. organization_id is nullable and fails
-- closed (owner-only) when NULL, exactly like agent/workflow.
CREATE TABLE IF NOT EXISTS "skill" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "slug" text NOT NULL,
  "source" text NOT NULL,
  "content" text NOT NULL,
  "icon" json,
  "user_id" uuid NOT NULL,
  "organization_id" text,
  "visibility" varchar DEFAULT 'private' NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint

ALTER TABLE "skill"
  ADD CONSTRAINT "skill_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;
ALTER TABLE "skill"
  ADD CONSTRAINT "skill_organization_id_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "skill_organization_id_idx" ON "skill" ("organization_id");
CREATE INDEX IF NOT EXISTS "skill_user_id_idx" ON "skill" ("user_id");
