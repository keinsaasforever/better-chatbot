-- Route general chat to the Base model.
--
-- general_chat is the fallback bucket: it wins whenever no task keyword
-- matched, which in practice covers most connected-tool requests phrased
-- without a tool noun ("was steht morgen an?", "any process audit meeting
-- next week?"). gemini-2.5-flash led that bucket on price alone, and it
-- fumbles tool calls — dropping required parameters and surfacing raw tool
-- errors mid-answer. The Base model already leads tool_calling at 95; giving
-- it the general_chat lead too means an unmatched prompt that turns out to
-- need tools is served by a model that can actually drive them. The two are
-- close enough in price for this to be cheap: $0.50/$2.80 per million against
-- flash's $0.30/$2.50 (0034 deployment rows).
--
-- gemini-2.5-flash drops to last in the bucket rather than out of it. For a
-- bucket that spills into tool use, a stronger fallback beats the cheapest
-- one, so gpt-5.6-terra now outranks it. Orgs with a price cap tight enough
-- to exclude the Base model exclude terra too (it is the pricier of the two),
-- so flash still serves them — it is filtered in, not ranked in.

INSERT INTO "model_task_profile" (
  "model_id", "task_key", "score", "tie_break_priority", "best_task_description", "evidence"
)
SELECT m."model", p."task_key", p."score", p."tie_break_priority", p."best_task_description", p."evidence"
FROM "models" m
CROSS JOIN (
  VALUES
    ('Base model', 'general_chat', 95, 40, 'Default for everyday chat, including requests that turn out to need connected tools.', 'Product default; leads tool_calling at 95 and general chat routes into tool use often enough that flash-class tool failures dominate the experience, 2026-07.'),
    ('gemini-2.5-flash', 'general_chat', 86, 30, 'Last resort for simple questions, for org price caps that exclude every stronger model.', 'Cheapest catalog model ($0.30/$2.50, ai-gateway), 2026-07; demoted from primary for weak tool calling.')
) AS p("model", "task_key", "score", "tie_break_priority", "best_task_description", "evidence")
WHERE m."model" = p."model"
ON CONFLICT ("model_id", "task_key") DO UPDATE SET
  "score" = EXCLUDED."score",
  "tie_break_priority" = EXCLUDED."tie_break_priority",
  "best_task_description" = EXCLUDED."best_task_description",
  "evidence" = EXCLUDED."evidence",
  "updated_at" = CURRENT_TIMESTAMP;
