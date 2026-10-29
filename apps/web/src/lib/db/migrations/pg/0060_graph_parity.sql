-- Knowledge graph parity with gbrain: entity resolution, salience, and
-- contradiction tracking.
--
--   * pg_trgm lets `resolveOrCreatePage` and the nightly dedupe find pages
--     whose aliases are close but not identical ("Paul" vs "Paul Müller",
--     "moebel.de" vs "Moebel.de GmbH") without an LLM call per entity.
--   * `project_brain_page.merged_into_page_id` / `archived_at` keep a merged
--     duplicate addressable (old links and citations still resolve) while
--     hiding it from the graph, retrieval and consolidation.
--   * `salience` is recomputed by the dream cycle from degree, fact count,
--     recency and source diversity; graph ordering and retrieval boosts read it.
--   * `project_brain_contradiction` stores fact pairs the dream cycle judged
--     inconsistent, surfaced as status blockers and on the Brain tab.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
ALTER TABLE "project_brain_page" ADD COLUMN IF NOT EXISTS "merged_into_page_id" uuid REFERENCES "project_brain_page"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "project_brain_page" ADD COLUMN IF NOT EXISTS "salience" numeric(8, 3) DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_brain_page" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_brain_page_project_salience_idx" ON "project_brain_page" ("project_id", "salience");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_brain_link_project_type_idx" ON "project_brain_link" ("project_id", "link_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_brain_alias_normalized_trgm_idx" ON "project_brain_alias" USING gin ("normalized_alias" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_brain_page_title_trgm_idx" ON "project_brain_page" USING gin (lower("title") gin_trgm_ops);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_brain_contradiction" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "project"("id") ON DELETE cascade,
  "page_id" uuid NOT NULL REFERENCES "project_brain_page"("id") ON DELETE cascade,
  "fact_key" text NOT NULL,
  "fact_id_a" uuid NOT NULL REFERENCES "project_brain_fact"("id") ON DELETE cascade,
  "fact_id_b" uuid NOT NULL REFERENCES "project_brain_fact"("id") ON DELETE cascade,
  "verdict" varchar(16) DEFAULT 'unknown' NOT NULL,
  "explanation" text,
  "status" varchar(16) DEFAULT 'open' NOT NULL,
  "resolved_by_user_id" uuid REFERENCES "user"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_brain_contradiction_pair_idx" ON "project_brain_contradiction" ("fact_id_a", "fact_id_b");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_brain_contradiction_project_status_idx" ON "project_brain_contradiction" ("project_id", "status");
