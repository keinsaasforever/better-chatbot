-- July 2026 routing catalog: adds the current model lineup as routing
-- candidates, re-scores the task-fit matrix (new task keys: web_search,
-- web_development, writing), backfills org access, and bumps the audit
-- policy version. Old menu models (claude-sonnet-4.6, gpt-5.5, llama) keep
-- their active deployments so stale manual selections do not hard-fail, but
-- lose their task profiles so automatic routing never picks them again.

INSERT INTO "models" ("model", "developer", "text", "vision", "description")
VALUES
  ('claude-sonnet-5', 'Anthropic', true, true, 'Frontier coding and structured work at a balanced price.'),
  ('claude-opus-4.8', 'Anthropic', true, true, 'Deep analysis, table extraction and creation, hard reasoning.'),
  ('claude-fable-5', 'Anthropic', true, true, 'Premium reasoning and long-form writing.'),
  ('gpt-5.6-sol', 'OpenAI', true, true, 'Flagship reasoning and coding.'),
  ('gpt-5.6-terra', 'OpenAI', true, true, 'Balanced general work and professional writing.'),
  ('gpt-5.6-luna', 'OpenAI', true, true, 'Fast, low-cost answers.'),
  ('glm-5.2', 'Z.ai', true, false, 'Website and frontend generation specialist.'),
  ('kimi-k2.6', 'Moonshot AI', true, true, 'Agentic tool use and general assistant work.'),
  ('kimi-k3', 'Moonshot AI', true, true, 'Frontier open-weights generalist with top tool calling.'),
  ('grok-4.5', 'xAI', true, true, 'Live-information reasoning and writing.'),
  ('grok-4.3', 'xAI', true, true, 'Fast search-style questions at low cost.'),
  ('qwen3.7-max', 'Alibaba', true, false, 'Large multilingual generalist.'),
  ('qwen3.7-plus', 'Alibaba', true, true, 'Cheap, fast multimodal work.'),
  ('gemini-3.1-pro-preview', 'Google', true, true, 'Multimodal flagship for vision, writing, and long context.')
ON CONFLICT ("model") DO NOTHING;

UPDATE "models"
SET
  "routing_description" = metadata."routing_description",
  "quality_score" = metadata."quality_score",
  "latency_tier" = metadata."latency_tier",
  "active" = true
FROM (
  VALUES
    ('claude-sonnet-5', 'Best price-performance for TypeScript, refactoring, debugging, and code review.', 0.93, 'balanced'),
    ('claude-opus-4.8', 'Best for the hardest analytical questions, table extraction and creation, and document reasoning.', 0.97, 'slow'),
    ('claude-fable-5', 'Premium option for frontier reasoning and long-form writing.', 0.98, 'slow'),
    ('gpt-5.6-sol', 'Top coding-index and GPQA scores; strong fallback for coding and reasoning.', 0.95, 'slow'),
    ('gpt-5.6-terra', 'Balanced general assistant and professional writing at mid price.', 0.90, 'balanced'),
    ('gpt-5.6-luna', 'Fast, low-cost general answers.', 0.82, 'fast'),
    ('glm-5.2', 'Best community-rated model for building websites and frontends, at a low price.', 0.88, 'balanced'),
    ('kimi-k2.6', 'Agentic tool use and general assistant work.', 0.84, 'balanced'),
    ('kimi-k3', 'Top tool-calling benchmark scores; strong open-weights generalist.', 0.88, 'balanced'),
    ('grok-4.5', 'Strong creative writing and live-information reasoning.', 0.90, 'balanced'),
    ('grok-4.3', 'Fast, cheap current-events and search-style answers.', 0.82, 'fast'),
    ('qwen3.7-max', 'Large multilingual generalist.', 0.86, 'balanced'),
    ('qwen3.7-plus', 'Cheap, fast multimodal work.', 0.80, 'fast'),
    ('gemini-3.1-pro-preview', 'Best multimodal model; community-leading creative writing at low price.', 0.94, 'balanced')
) AS metadata("model", "routing_description", "quality_score", "latency_tier")
WHERE "models"."model" = metadata."model";

-- Deployments: provider / provider_model_id must equal the app's static model
-- catalog keys (apps/web/src/lib/ai/models.ts) so routed picks resolve.
-- Prices in micros per million tokens, sourced from the Vercel AI Gateway
-- (see the billing price table, 2026-07-20).
INSERT INTO "model_deployment" (
  "model_id", "provider", "provider_model_id", "region", "data_retention",
  "input_price_micros_per_million", "output_price_micros_per_million",
  "context_tokens", "supports_tools", "supports_vision"
)
SELECT m."model", v."provider", v."provider_model_id", NULL, 'standard',
  v."input_micros", v."output_micros", v."context_tokens", true, v."supports_vision"
FROM "models" m
JOIN (
  VALUES
    ('claude-sonnet-5', 'anthropic', 'claude-sonnet-5', 3000000::bigint, 15000000::bigint, 1000000, true),
    ('claude-opus-4.8', 'anthropic', 'claude-opus-4.8', 5000000, 25000000, 1000000, true),
    ('claude-fable-5', 'anthropic', 'claude-fable-5', 10000000, 50000000, 1000000, true),
    ('gpt-5.6-sol', 'openai', 'gpt-5.6-sol', 5000000, 30000000, 1050000, true),
    ('gpt-5.6-terra', 'openai', 'gpt-5.6-terra', 2500000, 15000000, 1050000, true),
    ('gpt-5.6-luna', 'openai', 'gpt-5.6-luna', 1000000, 6000000, 1050000, true),
    ('glm-5.2', 'zai', 'glm-5.2', 1400000, 4400000, 1000000, false),
    ('kimi-k2.6', 'moonshotai', 'kimi-k2.6', 3000000, 15000000, 262144, true),
    ('kimi-k3', 'moonshotai', 'kimi-k3', 3000000, 15000000, 1048576, true),
    ('grok-4.5', 'xai', 'grok-4.5', 4000000, 12000000, 500000, true),
    ('grok-4.3', 'xai', 'grok-4.3', 1250000, 2500000, 1000000, true),
    ('qwen3.7-max', 'alibaba', 'qwen3.7-max', 2500000, 7500000, 991000, false),
    ('qwen3.7-plus', 'alibaba', 'qwen3.7-plus', 400000, 1600000, 1000000, true),
    ('gemini-3.1-pro-preview', 'google', 'gemini-3.1-pro-preview', 2000000, 12000000, 1000000, true)
) AS v("model", "provider", "provider_model_id", "input_micros", "output_micros", "context_tokens", "supports_vision")
  ON m."model" = v."model"
ON CONFLICT ("provider", "provider_model_id") DO NOTHING;

-- Remove old menu models from routing (their deployments stay active so a
-- stale manual selection keeps working; the menu no longer offers them).
DELETE FROM "model_task_profile"
WHERE "model_id" IN ('claude-sonnet-4.6', 'gpt-5.5', 'llama-3.3-70b-instruct');

-- Task-fit matrix. Winners were picked from community leaderboards balanced
-- against gateway price (best price-performance per task); the evidence
-- column records source + date so future leaderboard checks can re-score.
INSERT INTO "model_task_profile" (
  "model_id", "task_key", "score", "tie_break_priority", "best_task_description", "evidence"
)
SELECT m."model", p."task_key", p."score", p."tie_break_priority", p."best_task_description", p."evidence"
FROM "models" m
CROSS JOIN (
  VALUES
    ('Base model', 'tool_calling', 95, 30, 'Default for straightforward connected-tool and assistant tasks.', 'Product default; Kimi line leads tool-calling (llm-stats.com, 2026-07).'),
    ('kimi-k3', 'tool_calling', 85, 20, 'Fallback for demanding multi-step tool workflows.', 'llm-stats.com tool-calling #1 (46.6), 2026-07; 6x Base model price.'),
    ('gpt-5.6-terra', 'tool_calling', 82, 10, 'Second fallback for connected-tool work.', 'benchlm.ai agentic #2 (73.1), 2026-07.'),
    ('gemini-2.5-flash', 'web_search', 95, 30, 'Web search and quick research synthesis via the WebSearch tool.', 'Cheapest tool-capable model ($0.30/$2.50, ai-gateway), 2026-07.'),
    ('grok-4.3', 'web_search', 84, 10, 'Fallback for current-events search questions.', 'xAI live-information line, $1.25/$2.50 (ai-gateway), 2026-07.'),
    ('gpt-5.6-luna', 'web_search', 83, 5, 'Second fallback for quick search questions.', '$1/$6 (ai-gateway), 2026-07.'),
    ('qwen3.7-plus', 'web_search', 82, 0, 'Budget fallback for search questions.', '$0.40/$1.60 (ai-gateway), 2026-07.'),
    ('gemini-2.5-flash', 'general_chat', 92, 30, 'Fast, cheap answers for simple questions.', 'Cheapest catalog model ($0.30/$2.50, ai-gateway), 2026-07.'),
    ('gpt-5.6-terra', 'general_chat', 88, 20, 'Balanced fallback for general questions.', '$2.50/$15 (ai-gateway), 2026-07.'),
    ('gpt-5.6-luna', 'general_chat', 82, 10, 'Fast fallback for general questions.', '$1/$6 (ai-gateway), 2026-07.'),
    ('claude-opus-4.8', 'document_extraction', 95, 30, 'Hard document work: table extraction and creation, contracts, invoices.', 'Arena Overall #1 (~1510 Elo, arena.ai), 2026-07; user-selected primary.'),
    ('gemini-3.1-pro-preview', 'document_extraction', 88, 20, 'Multimodal fallback for large-document extraction.', 'Best multimodal model 2026 at $2/$12 (ai-gateway), 2026-07.'),
    ('gemini-2.5-flash', 'document_extraction', 85, 10, 'Budget fallback for bulk extraction.', 'Was primary in mvp-v1; now budget fallback, 2026-07.'),
    ('claude-opus-4.8', 'reasoning', 95, 30, 'Hardest analytical questions and multi-step reasoning.', 'Arena Overall #1 (~1510 Elo, arena.ai), 2026-07.'),
    ('claude-fable-5', 'reasoning', 92, 20, 'Premium fallback for frontier reasoning.', 'EQ-Bench leader; $10/$50 (ai-gateway), 2026-07.'),
    ('gpt-5.6-sol', 'reasoning', 90, 10, 'Fallback for hard reasoning.', 'GPQA #1 (llm-stats.com), 2026-07.'),
    ('glm-5.2', 'web_development', 95, 30, 'Building websites, landing pages, and frontends.', 'Design Arena Website #1 (1343, designarena.ai), 2026-07, at $1.40/$4.40.'),
    ('claude-sonnet-5', 'web_development', 88, 20, 'Fallback for website and frontend building.', 'Anthropic line leads Arena WebDev (arena.ai), 2026-07.'),
    ('gpt-5.6-sol', 'web_development', 85, 10, 'Second fallback for web development.', 'Coding-index #1 (llm-stats.com), 2026-07.'),
    ('claude-sonnet-5', 'coding', 95, 30, 'TypeScript, refactoring, debugging, and code review.', 'Near coding-index top at half the price of gpt-5.6-sol (llm-stats.com), 2026-07.'),
    ('gpt-5.6-sol', 'coding', 90, 10, 'Fallback for coding.', 'Coding-index #1 (49.6, llm-stats.com), 2026-07.'),
    ('glm-5.2', 'coding', 88, 5, 'Budget fallback for coding.', 'Strong coding line at $1.40/$4.40 (ai-gateway), 2026-07.'),
    ('kimi-k3', 'coding', 82, 0, 'Open-weights fallback for coding.', 'llm-stats.com, 2026-07.'),
    ('gemini-3.1-pro-preview', 'writing', 95, 30, 'Articles, posts, and creative or professional writing.', 'Arena Creative Writing leader (arena.ai), 2026-07, cheapest top writer at $2/$12.'),
    ('grok-4.5', 'writing', 86, 10, 'Fallback for creative writing.', 'Grok line top-3 Arena Creative Writing; Creative Writing v3 #1 (llm-stats.com), 2026-07.'),
    ('claude-fable-5', 'writing', 85, 5, 'Premium fallback for long-form writing.', 'EQ-Bench Creative Writing #1 (2230 Elo), 2026-07; $10/$50.'),
    ('gpt-5.6-terra', 'writing', 84, 0, 'Budget fallback for professional writing.', '$2.50/$15 (ai-gateway), 2026-07.'),
    ('gemini-3.1-pro-preview', 'german_business_writing', 95, 30, 'German business writing and polished customer communication.', 'Arena Creative Writing leader (arena.ai), 2026-07; replaces gpt-5.5.'),
    ('gpt-5.6-terra', 'german_business_writing', 88, 20, 'Fallback for German business writing.', 'Successor of gpt-5.5 (previous primary), 2026-07.'),
    ('claude-fable-5', 'german_business_writing', 85, 10, 'Premium fallback for German business writing.', 'EQ-Bench leader, 2026-07.'),
    ('gemini-3.1-pro-preview', 'vision', 95, 30, 'Image-aware requests and multimodal analysis.', 'Best multimodal model 2026 (arena.ai vision rankings), 2026-07.'),
    ('gemini-2.5-flash', 'vision', 88, 20, 'Fast, cheap fallback for image requests.', 'Was primary in mvp-v1; budget fallback, 2026-07.'),
    ('claude-sonnet-5', 'vision', 85, 10, 'Second fallback for image requests.', 'ai-gateway model card, 2026-07.')
) AS p("model", "task_key", "score", "tie_break_priority", "best_task_description", "evidence")
WHERE m."model" = p."model"
ON CONFLICT ("model_id", "task_key") DO UPDATE SET
  "score" = EXCLUDED."score",
  "tie_break_priority" = EXCLUDED."tie_break_priority",
  "best_task_description" = EXCLUDED."best_task_description",
  "evidence" = EXCLUDED."evidence",
  "updated_at" = CURRENT_TIMESTAMP;

-- Every org gets the new deployments enabled (mirrors 0034); existing access
-- rows (including admin-disabled ones) are left untouched.
INSERT INTO "organization_model_access" ("organization_id", "deployment_id", "enabled")
SELECT o."id", d."id", true
FROM "organization" o
CROSS JOIN "model_deployment" d
ON CONFLICT ("organization_id", "deployment_id") DO NOTHING;

ALTER TABLE "model_route_audit" ALTER COLUMN "policy_version" SET DEFAULT 'mvp-v2';
