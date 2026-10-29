-- Normalize the legacy Supabase model catalog to the columns used by the
-- current Drizzle schema. Legacy-only columns are intentionally retained so
-- existing integrations and catalog data continue to work.
ALTER TABLE "models"
  ADD COLUMN IF NOT EXISTS "developer" text,
  ADD COLUMN IF NOT EXISTS "country" text,
  ADD COLUMN IF NOT EXISTS "text" boolean,
  ADD COLUMN IF NOT EXISTS "vision" boolean,
  ADD COLUMN IF NOT EXISTS "audio" boolean,
  ADD COLUMN IF NOT EXISTS "hiddenGem" boolean,
  ADD COLUMN IF NOT EXISTS "caution" boolean,
  ADD COLUMN IF NOT EXISTS "notRecommended" boolean,
  ADD COLUMN IF NOT EXISTS "cheapAlternative" boolean,
  ADD COLUMN IF NOT EXISTS "speed" boolean,
  ADD COLUMN IF NOT EXISTS "thinking" boolean,
  ADD COLUMN IF NOT EXISTS "maxPerformance" boolean,
  ADD COLUMN IF NOT EXISTS "input_price_usd" numeric(20, 10),
  ADD COLUMN IF NOT EXISTS "output_price_usd" numeric(20, 10),
  ADD COLUMN IF NOT EXISTS "context_tokens" integer,
  ADD COLUMN IF NOT EXISTS "description" text,
  ADD COLUMN IF NOT EXISTS "created_at" timestamp,
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp;

-- Widen columns created by an earlier failed run before normalizing legacy
-- per-million prices into the canonical per-token representation below.
ALTER TABLE "models"
  ALTER COLUMN "input_price_usd" TYPE numeric(20, 10)
    USING "input_price_usd"::numeric,
  ALTER COLUMN "output_price_usd" TYPE numeric(20, 10)
    USING "output_price_usd"::numeric;

-- Preserve legacy vision and price metadata when those source columns exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'models'
      AND column_name = 'image'
  ) THEN
    EXECUTE 'UPDATE "models" SET "vision" = COALESCE("vision", "image", false)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'models'
      AND column_name = 'input_1m_USD'
  ) THEN
    EXECUTE 'UPDATE "models" SET "input_price_usd" = COALESCE("input_price_usd", ("input_1m_USD"::numeric / 1000000.0))';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'models'
      AND column_name = 'output_1m_USD'
  ) THEN
    EXECUTE 'UPDATE "models" SET "output_price_usd" = COALESCE("output_price_usd", ("output_1m_USD"::numeric / 1000000.0))';
  END IF;
END $$;

UPDATE "models"
SET
  "developer" = COALESCE(NULLIF(TRIM("developer"), ''), 'Unknown'),
  "text" = COALESCE("text", false),
  "vision" = COALESCE("vision", false),
  "audio" = COALESCE("audio", false),
  "hiddenGem" = COALESCE("hiddenGem", false),
  "caution" = COALESCE("caution", false),
  "notRecommended" = COALESCE("notRecommended", false),
  "cheapAlternative" = COALESCE("cheapAlternative", false),
  "speed" = COALESCE("speed", false),
  "thinking" = COALESCE("thinking", false),
  "maxPerformance" = COALESCE("maxPerformance", false),
  "created_at" = COALESCE("created_at", CURRENT_TIMESTAMP),
  "updated_at" = COALESCE("updated_at", CURRENT_TIMESTAMP);

ALTER TABLE "models"
  ALTER COLUMN "developer" SET NOT NULL,
  ALTER COLUMN "text" SET DEFAULT false,
  ALTER COLUMN "text" SET NOT NULL,
  ALTER COLUMN "vision" SET DEFAULT false,
  ALTER COLUMN "vision" SET NOT NULL,
  ALTER COLUMN "audio" SET DEFAULT false,
  ALTER COLUMN "audio" SET NOT NULL,
  ALTER COLUMN "hiddenGem" SET DEFAULT false,
  ALTER COLUMN "hiddenGem" SET NOT NULL,
  ALTER COLUMN "caution" SET DEFAULT false,
  ALTER COLUMN "caution" SET NOT NULL,
  ALTER COLUMN "notRecommended" SET DEFAULT false,
  ALTER COLUMN "notRecommended" SET NOT NULL,
  ALTER COLUMN "cheapAlternative" SET DEFAULT false,
  ALTER COLUMN "cheapAlternative" SET NOT NULL,
  ALTER COLUMN "speed" SET DEFAULT false,
  ALTER COLUMN "speed" SET NOT NULL,
  ALTER COLUMN "thinking" SET DEFAULT false,
  ALTER COLUMN "thinking" SET NOT NULL,
  ALTER COLUMN "maxPerformance" SET DEFAULT false,
  ALTER COLUMN "maxPerformance" SET NOT NULL,
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "created_at" SET NOT NULL,
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" SET NOT NULL;

CREATE TABLE IF NOT EXISTS "model_deployment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "model_id" text NOT NULL REFERENCES "models"("model") ON DELETE cascade,
  "provider" text NOT NULL,
  "provider_model_id" text NOT NULL,
  "region" text,
  "data_retention" text DEFAULT 'unknown' NOT NULL,
  "evidence_url" text,
  "retention_verified_at" timestamp,
  "input_price_micros_per_million" bigint DEFAULT 0 NOT NULL,
  "output_price_micros_per_million" bigint DEFAULT 0 NOT NULL,
  "context_tokens" integer DEFAULT 0 NOT NULL,
  "supports_tools" boolean DEFAULT false NOT NULL,
  "supports_vision" boolean DEFAULT false NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "model_deployment_provider_model_unique" UNIQUE("provider", "provider_model_id")
);
CREATE INDEX IF NOT EXISTS "model_deployment_model_idx" ON "model_deployment" ("model_id");
CREATE INDEX IF NOT EXISTS "model_deployment_active_idx" ON "model_deployment" ("active");

CREATE TABLE IF NOT EXISTS "model_task_profile" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "model_id" text NOT NULL REFERENCES "models"("model") ON DELETE cascade,
  "task_key" text NOT NULL,
  "score" integer NOT NULL,
  "tie_break_priority" integer DEFAULT 0 NOT NULL,
  "best_task_description" text NOT NULL,
  "limitations" text,
  "evidence" text,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "model_task_profile_model_task_unique" UNIQUE("model_id", "task_key")
);
CREATE INDEX IF NOT EXISTS "model_task_profile_task_idx" ON "model_task_profile" ("task_key");

CREATE TABLE IF NOT EXISTS "organization_ai_policy" (
  "organization_id" text PRIMARY KEY NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "automatic_routing_enabled" boolean DEFAULT true NOT NULL,
  "max_input_price_micros_per_million" bigint,
  "max_output_price_micros_per_million" bigint,
  "max_estimated_request_micros" bigint,
  "allowed_regions" text[],
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS "organization_model_access" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "deployment_id" uuid NOT NULL REFERENCES "model_deployment"("id") ON DELETE cascade,
  "enabled" boolean DEFAULT true NOT NULL,
  "input_price_micros_per_million_override" bigint,
  "output_price_micros_per_million_override" bigint,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "organization_model_access_org_deployment_unique" UNIQUE("organization_id", "deployment_id")
);
CREATE INDEX IF NOT EXISTS "organization_model_access_org_idx" ON "organization_model_access" ("organization_id");

CREATE TABLE IF NOT EXISTS "member_ai_policy" (
  "member_id" text PRIMARY KEY NOT NULL REFERENCES "member"("id") ON DELETE cascade,
  "monthly_cap_micros" bigint,
  "hard_stop" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS "member_ai_usage_period" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "member_id" text NOT NULL REFERENCES "member"("id") ON DELETE cascade,
  "period_start" timestamp NOT NULL,
  "period_end" timestamp NOT NULL,
  "finalized_micros" bigint DEFAULT 0 NOT NULL,
  "reserved_micros" bigint DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "member_ai_usage_period_member_start_unique" UNIQUE("member_id", "period_start")
);
CREATE INDEX IF NOT EXISTS "member_ai_usage_period_member_idx" ON "member_ai_usage_period" ("member_id");

CREATE TABLE IF NOT EXISTS "member_ai_reservation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "usage_period_id" uuid NOT NULL REFERENCES "member_ai_usage_period"("id") ON DELETE cascade,
  "deployment_id" uuid NOT NULL REFERENCES "model_deployment"("id") ON DELETE restrict,
  "idempotency_key" text NOT NULL UNIQUE,
  "estimate_micros" bigint NOT NULL,
  "actual_micros" bigint,
  "status" text DEFAULT 'reserved' NOT NULL,
  "expires_at" timestamp NOT NULL,
  "finalized_at" timestamp,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS "member_ai_reservation_period_idx" ON "member_ai_reservation" ("usage_period_id");
CREATE INDEX IF NOT EXISTS "member_ai_reservation_status_idx" ON "member_ai_reservation" ("status");

CREATE TABLE IF NOT EXISTS "model_route_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text REFERENCES "organization"("id") ON DELETE set null,
  "member_id" text REFERENCES "member"("id") ON DELETE set null,
  "deployment_id" uuid NOT NULL REFERENCES "model_deployment"("id") ON DELETE restrict,
  "task_key" text NOT NULL,
  "task_score" integer NOT NULL,
  "selector" text DEFAULT 'deterministic' NOT NULL,
  "reason_code" text NOT NULL,
  "policy_version" text DEFAULT 'mvp-v1' NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS "model_route_audit_member_idx" ON "model_route_audit" ("member_id");
CREATE INDEX IF NOT EXISTS "model_route_audit_created_idx" ON "model_route_audit" ("created_at");

ALTER TABLE "models"
  ADD COLUMN IF NOT EXISTS "routing_description" text,
  ADD COLUMN IF NOT EXISTS "routing_profile" json,
  ADD COLUMN IF NOT EXISTS "capabilities" json,
  ADD COLUMN IF NOT EXISTS "quality_score" numeric(3, 2),
  ADD COLUMN IF NOT EXISTS "latency_tier" text,
  ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true NOT NULL;

INSERT INTO "models" ("model", "developer", "text", "vision", "description")
VALUES
  ('Base model', 'Navigator', true, true, 'General Navigator chat and tool work.'),
  ('claude-sonnet-4.6', 'Anthropic', true, true, 'Strong coding, analysis, and tool use.'),
  ('gpt-5.5', 'OpenAI', true, true, 'High-quality general reasoning and writing.'),
  ('gemini-2.5-flash', 'Google', true, true, 'Fast multimodal and extraction work.'),
  ('llama-3.3-70b-instruct', 'Meta', true, false, 'Cost-effective general and tool-capable work via TensorX.')
ON CONFLICT ("model") DO NOTHING;

UPDATE "models"
SET
  "routing_description" = metadata."routing_description",
  "routing_profile" = metadata."routing_profile"::json,
  "capabilities" = metadata."capabilities"::json,
  "quality_score" = metadata."quality_score",
  "latency_tier" = metadata."latency_tier",
  "active" = true
FROM (
  VALUES
    ('Base model', 'General Navigator chat and connected-tool orchestration.', '{"taskTypes":["general_chat","tool_calling"],"useCases":["general assistant work","connected tools"],"avoidUseCases":["specialist coding"],"strengths":["tool orchestration"],"limitations":["not the top specialist model"],"capabilityScores":{"reasoning":0.8,"coding":0.7,"toolUse":0.9,"extraction":0.7,"writing":0.8}}', '["chat","tools","vision","long_context"]', 0.80, 'balanced'),
    ('claude-sonnet-4.6', 'Best for TypeScript, refactoring, debugging, and careful structured reasoning.', '{"taskTypes":["coding","reasoning"],"useCases":["TypeScript refactors","code review","complex analysis"],"avoidUseCases":["lowest-cost extraction"],"strengths":["coding","reasoning"],"limitations":["higher token price"],"capabilityScores":{"reasoning":0.9,"coding":0.95,"toolUse":0.9,"extraction":0.8,"writing":0.85}}', '["chat","reasoning","tools","vision","long_context"]', 0.92, 'balanced'),
    ('gpt-5.5', 'Best for high-quality general answers and polished professional writing.', '{"taskTypes":["general_chat","german_business_writing"],"useCases":["professional writing","general reasoning"],"avoidUseCases":["cost-sensitive bulk work"],"strengths":["writing","reasoning"],"limitations":["premium token price"],"capabilityScores":{"reasoning":0.95,"coding":0.9,"toolUse":0.9,"extraction":0.85,"writing":0.95}}', '["chat","reasoning","tools","vision","long_context"]', 0.95, 'slow'),
    ('gemini-2.5-flash', 'Best for fast document extraction, large-context synthesis, and image-aware requests.', '{"taskTypes":["document_extraction","vision"],"useCases":["large document extraction","image analysis"],"avoidUseCases":["the hardest code review"],"strengths":["long context","vision","extraction"],"limitations":["not the highest coding score"],"capabilityScores":{"reasoning":0.8,"coding":0.75,"toolUse":0.8,"extraction":0.9,"writing":0.8}}', '["chat","tools","vision","long_context"]', 0.86, 'fast'),
    ('llama-3.3-70b-instruct', 'TensorX zero-inference-content-retention option for approved general chat and tool requests.', '{"taskTypes":["general_chat","tool_calling"],"useCases":["zero-retention general chat","zero-retention tool use"],"avoidUseCases":["vision"],"strengths":["privacy deployment option"],"limitations":["price must be configured before use"],"capabilityScores":{"reasoning":0.72,"coding":0.7,"toolUse":0.7,"extraction":0.65,"writing":0.72}}', '["chat","tools"]', 0.72, 'balanced')
) AS metadata("model", "routing_description", "routing_profile", "capabilities", "quality_score", "latency_tier")
WHERE "models"."model" = metadata."model";

INSERT INTO "model_deployment" (
  "model_id", "provider", "provider_model_id", "region", "data_retention",
  "input_price_micros_per_million", "output_price_micros_per_million",
  "context_tokens", "supports_tools", "supports_vision"
)
SELECT "model", 'Navigator', 'Base model', NULL, 'standard', 500000, 2800000, 128000, true, true
FROM "models" WHERE "model" = 'Base model'
ON CONFLICT ("provider", "provider_model_id") DO NOTHING;

INSERT INTO "model_deployment" (
  "model_id", "provider", "provider_model_id", "region", "data_retention",
  "input_price_micros_per_million", "output_price_micros_per_million",
  "context_tokens", "supports_tools", "supports_vision"
)
SELECT "model", 'anthropic', 'claude-sonnet-4.6', NULL, 'standard', 3000000, 15000000, 200000, true, true
FROM "models" WHERE "model" = 'claude-sonnet-4.6'
ON CONFLICT ("provider", "provider_model_id") DO NOTHING;

INSERT INTO "model_deployment" (
  "model_id", "provider", "provider_model_id", "region", "data_retention",
  "input_price_micros_per_million", "output_price_micros_per_million",
  "context_tokens", "supports_tools", "supports_vision"
)
SELECT "model", 'openai', 'gpt-5.5', NULL, 'standard', 5000000, 30000000, 1050000, true, true
FROM "models" WHERE "model" = 'gpt-5.5'
ON CONFLICT ("provider", "provider_model_id") DO NOTHING;

INSERT INTO "model_deployment" (
  "model_id", "provider", "provider_model_id", "region", "data_retention",
  "input_price_micros_per_million", "output_price_micros_per_million",
  "context_tokens", "supports_tools", "supports_vision"
)
SELECT "model", 'google', 'gemini-2.5-flash', NULL, 'standard', 300000, 2500000, 1000000, true, true
FROM "models" WHERE "model" = 'gemini-2.5-flash'
ON CONFLICT ("provider", "provider_model_id") DO NOTHING;

INSERT INTO "model_deployment" (
  "model_id", "provider", "provider_model_id", "region", "data_retention",
  "evidence_url", "retention_verified_at", "context_tokens",
  "supports_tools", "supports_vision"
)
SELECT "model", 'TensorX', 'meta-llama/Meta-Llama-3.3-70B-Instruct', 'EU', 'zero', 'https://tensorx.ai', CURRENT_TIMESTAMP, 131072, true, false
FROM "models" WHERE "model" = 'llama-3.3-70b-instruct'
ON CONFLICT ("provider", "provider_model_id") DO NOTHING;

INSERT INTO "model_task_profile" (
  "model_id", "task_key", "score", "tie_break_priority", "best_task_description"
)
SELECT m."model", p."task_key", p."score", p."tie_break_priority", p."best_task_description"
FROM "models" m
CROSS JOIN (
  VALUES
    ('Base model', 'general_chat', 80, 10, 'General assistant work and connected-tool orchestration.'),
    ('Base model', 'tool_calling', 85, 10, 'Connected-tool workflows and multi-step assistant tasks.'),
    ('claude-sonnet-4.6', 'coding', 95, 20, 'TypeScript, refactoring, debugging, and careful code review.'),
    ('claude-sonnet-4.6', 'reasoning', 90, 20, 'Complex analysis and structured reasoning.'),
    ('gpt-5.5', 'general_chat', 92, 20, 'High-quality general answers and professional writing.'),
    ('gpt-5.5', 'german_business_writing', 90, 20, 'German business writing and polished customer communication.'),
    ('gemini-2.5-flash', 'document_extraction', 90, 20, 'Fast extraction and summarization of large documents.'),
    ('gemini-2.5-flash', 'vision', 90, 20, 'Image-aware extraction and multimodal requests.'),
    ('llama-3.3-70b-instruct', 'general_chat', 72, 5, 'Zero-retention general chat when the TensorX deployment is required.'),
    ('llama-3.3-70b-instruct', 'tool_calling', 70, 5, 'Tool-capable zero-retention requests.' )
) AS p("model", "task_key", "score", "tie_break_priority", "best_task_description")
WHERE m."model" = p."model"
ON CONFLICT ("model_id", "task_key") DO NOTHING;

INSERT INTO "organization_ai_policy" ("organization_id")
SELECT "id" FROM "organization"
ON CONFLICT ("organization_id") DO NOTHING;

INSERT INTO "organization_model_access" ("organization_id", "deployment_id", "enabled")
SELECT o."id", d."id", true
FROM "organization" o
CROSS JOIN "model_deployment" d
ON CONFLICT ("organization_id", "deployment_id") DO NOTHING;
