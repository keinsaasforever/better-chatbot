-- Makes the curated TensorX lineup selectable: Kimi K3, Qwen3.8 2.4T A95B and
-- MiniMax M2, served directly from the EU TensorX endpoint with zero
-- inference-content retention.
--
-- provider / provider_model_id must equal the app's static catalog keys
-- (apps/web/src/lib/ai/models.ts) so a manual pick resolves — for TensorX the
-- catalog key is the menu name, and lib/ai/models.ts maps it to the TensorX
-- provider model id ("kimi-k3" -> "moonshotai/kimi-k3").
--
-- Deliberately no model_task_profile rows: these are manual-selection options,
-- so automatic routing keeps choosing from the gateway lineup unless an admin
-- scores them later.

INSERT INTO "models" ("model", "developer", "country", "text", "vision", "description")
VALUES
  ('qwen3.8-2.4t-a95b', 'Alibaba', 'CN', true, false, 'Large sparse multilingual generalist with long context.'),
  ('minimax-m2', 'MiniMax', 'CN', true, false, 'Fast, low-cost coding and agentic work.')
ON CONFLICT ("model") DO NOTHING;

-- Prices in micros per million tokens; mirror lib/autumn/llm-prices.ts. Both
-- must be > 0 or validateManualModel() rejects the model as unpriced.
INSERT INTO "model_deployment" (
  "model_id", "provider", "provider_model_id", "region", "data_retention",
  "evidence_url", "retention_verified_at",
  "input_price_micros_per_million", "output_price_micros_per_million",
  "context_tokens", "supports_tools", "supports_vision"
)
SELECT m."model", 'TensorX', v."provider_model_id", 'EU', 'zero',
  'https://tensorx.ai/trust-security/', CURRENT_TIMESTAMP,
  v."input_micros", v."output_micros", v."context_tokens", true, v."supports_vision"
FROM "models" m
JOIN (
  VALUES
    ('kimi-k3', 'kimi-k3', 3000000::bigint, 15000000::bigint, 1048576, true),
    ('qwen3.8-2.4t-a95b', 'qwen3.8-2.4t-a95b', 2000000, 6000000, 1048576, false),
    ('minimax-m2', 'minimax-m2', 300000, 1200000, 204800, false)
) AS v("model", "provider_model_id", "input_micros", "output_micros", "context_tokens", "supports_vision")
  ON m."model" = v."model"
ON CONFLICT ("provider", "provider_model_id") DO NOTHING;

-- Retire the TensorX/Meta-Llama deployment seeded by 0034. It lost its task
-- profiles in 0037 and its model is not in the static catalog, so it can only
-- surface as a dead entry next to the lineup above.
UPDATE "model_deployment"
SET "active" = false, "updated_at" = CURRENT_TIMESTAMP
WHERE "provider" = 'TensorX'
  AND "provider_model_id" = 'meta-llama/Meta-Llama-3.3-70B-Instruct'
  AND "active";

-- Every org gets the new deployments enabled (mirrors 0037). Scoped to the
-- three new rows so existing access rows — including admin-disabled ones and
-- the retired deployment above — are left exactly as they are.
INSERT INTO "organization_model_access" ("organization_id", "deployment_id", "enabled")
SELECT o."id", d."id", true
FROM "organization" o
CROSS JOIN "model_deployment" d
WHERE d."provider" = 'TensorX'
  AND d."provider_model_id" IN ('kimi-k3', 'qwen3.8-2.4t-a95b', 'minimax-m2')
ON CONFLICT ("organization_id", "deployment_id") DO NOTHING;
