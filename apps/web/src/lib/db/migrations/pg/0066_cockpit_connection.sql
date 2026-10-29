-- Per-scope credentials for the cockpit's data sources (website analytics,
-- Vercel, Stripe, Revolut Business, Superlog, SEO).
--
--   * A connection belongs to an organization, or to a user alone when no
--     organization is active (`organization_id` NULL). One row per scope and
--     provider, enforced by the expression index below.
--   * `config_encrypted` is the provider config sealed with AES-256-GCM
--     (`lib/crypto/secret-box.ts`, key `APP_SECRETS_KEY`):
--     base64(iv | tag | ciphertext). Nothing in this table is readable
--     without that key, and the API never returns a decrypted secret.
--   * `last_ok_at` / `last_error` hold the latest feed refresh or probe result
--     (an error code such as `unauthorized`, never a provider response body),
--     which drives the CONNECT console's LEDs.
CREATE TABLE IF NOT EXISTS "cockpit_connection" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "organization_id" text REFERENCES "organization"("id") ON DELETE CASCADE,
  "provider" varchar(32) NOT NULL,
  "label" text,
  "config_encrypted" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "last_ok_at" timestamp,
  "last_error" text,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cockpit_connection_scope_provider_idx"
  ON "cockpit_connection" (COALESCE("organization_id", 'user:' || "user_id"::text), "provider");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cockpit_connection_user_idx"
  ON "cockpit_connection" ("user_id");
