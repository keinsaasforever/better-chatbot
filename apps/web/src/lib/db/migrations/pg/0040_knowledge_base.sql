-- Standalone knowledge bases: named Agentset namespaces users fill from chat
-- uploads and bind to agents for scoped retrieval. Namespaces are provisioned
-- lazily on first ingest (slug kb-<id>), mirroring the per-project pattern.
CREATE TABLE IF NOT EXISTS "knowledge_base" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "organization_id" text REFERENCES "organization"("id") ON DELETE cascade,
  "visibility" varchar NOT NULL DEFAULT 'private',
  "agentset_namespace_id" text,
  "embedding_profile" text DEFAULT 'agentset-managed',
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS "knowledge_base_user_idx" ON "knowledge_base" ("user_id");
CREATE INDEX IF NOT EXISTS "knowledge_base_organization_idx" ON "knowledge_base" ("organization_id");
