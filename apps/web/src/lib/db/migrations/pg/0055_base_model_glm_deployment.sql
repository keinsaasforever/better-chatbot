-- Re-price and re-size the Navigator base-model deployment after the switch to
-- `zai/glm-5.3-flash`.
--
-- The routing catalog addresses the base model by alias (provider 'Navigator',
-- provider_model_id 'Base model'), so the swap in `lib/ai/models.ts` never
-- reached this row: it still carried the Kimi rate seeded in 0034 ($0.50/$2.80
-- per million, 128k context). Two things read it and were both wrong:
--
--   * member budget caps (`lib/ai/routing/budget.ts` estimateCostMicros) --
--     charging a base-model turn ~3.3x on input and ~5.6x on output against an
--     allowance the invoice never matches;
--   * routing eligibility (`isCandidateEligible`) -- a request declaring more
--     than 128k of minimum context would drop the base model from the
--     candidate set even though GLM 5.3 Flash serves 1M.
--
-- Figures match the `Navigator/Base model` row in `lib/autumn/llm-prices.ts`
-- ($0.15/M input, $0.50/M output, 1M context).
--
-- Per-organization price overrides in `organization_model_access` are left
-- untouched: an admin's explicit number stays authoritative.
UPDATE "model_deployment"
SET
  "input_price_micros_per_million" = 150000,
  "output_price_micros_per_million" = 500000,
  "context_tokens" = 1000000,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "provider" = 'Navigator'
  AND "provider_model_id" = 'Base model';
