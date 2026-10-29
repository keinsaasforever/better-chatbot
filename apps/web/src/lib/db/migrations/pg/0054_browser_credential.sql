-- Stored website sign-ins for browser automation.
--
-- Holds NO credential material. The username, password and any TOTP seed live
-- in one Scaleway Secret Manager secret and this row keeps only the pointer,
-- the same shape `navigator_connected_tools.external_secret_id` already uses.
-- `username_hint` is a masked display string computed at write time.
--
-- `domain` (and the narrower `allowed_url_prefix`) is not decoration: the
-- placeholder substitution in `lib/kernel/playwright-execute-tool` refuses to
-- resolve a credential anywhere but that origin. Without it, any page the agent
-- reads could tell it to type the password into an attacker's form, and an LLM
-- cannot tell page content from instructions.
--
-- Org-scoped: a scheduled task runs as its owner but inside the agent's
-- organization, and a company's portal login belongs to the company.
CREATE TABLE IF NOT EXISTS "browser_credential" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL,
  "created_by_user_id" uuid NOT NULL,
  "alias" varchar(64) NOT NULL,
  "label" text,
  "domain" text NOT NULL,
  "allowed_url_prefix" text,
  "username_hint" text,
  "external_secret_id" text,
  "kernel_profile_id" text,
  "kernel_profile_name" text,
  "profile_saved_at" timestamp,
  "last_used_at" timestamp,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "browser_credential"
    ADD CONSTRAINT "browser_credential_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "browser_credential"
    ADD CONSTRAINT "browser_credential_created_by_user_id_user_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "browser_credential_org_alias_idx"
  ON "browser_credential" ("organization_id", "alias");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "browser_credential_org_idx"
  ON "browser_credential" ("organization_id");
