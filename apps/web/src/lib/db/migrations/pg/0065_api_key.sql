-- API keys for the Navigator MCP server (`/api/navigator-mcp`).
--
-- Backs the Better Auth `apiKey` plugin (@better-auth/api-key 1.6). Columns
-- were taken from the plugin's own schema (`npx auth@1.6.2 generate` against a
-- throwaway database) and rewritten in this repo's style: snake_case columns,
-- a uuid primary key, and `reference_id` as a real foreign key to the user,
-- because keys are configured with `references: "user"` and must disappear
-- with their owner.
--
--   * `key` is the SHA-256 hash of the secret, never the secret itself; the
--     plaintext is shown once, at creation. `start` keeps its first characters
--     so the list in the app can tell keys apart.
--   * `metadata` is a JSON string. Navigator stores `{ "organizationId": ... }`
--     there: the organization a key acts in. Membership is re-checked on every
--     request, so a key outlives neither a removed member nor a left org.
--   * Rate limiting (`rate_limit_*`, `request_count`, `last_request`) is the
--     plugin's own per-key limiter.
CREATE TABLE IF NOT EXISTS "apikey" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "config_id" text DEFAULT 'default' NOT NULL,
  "name" text,
  "start" text,
  "reference_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "prefix" text,
  "key" text NOT NULL,
  "refill_interval" integer,
  "refill_amount" integer,
  "last_refill_at" timestamp,
  "enabled" boolean DEFAULT true,
  "rate_limit_enabled" boolean DEFAULT true,
  "rate_limit_time_window" integer,
  "rate_limit_max" integer,
  "request_count" integer DEFAULT 0,
  "remaining" integer,
  "last_request" timestamp,
  "expires_at" timestamp,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "permissions" text,
  "metadata" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "apikey_key_idx" ON "apikey" ("key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "apikey_reference_id_idx" ON "apikey" ("reference_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "apikey_config_id_idx" ON "apikey" ("config_id");
