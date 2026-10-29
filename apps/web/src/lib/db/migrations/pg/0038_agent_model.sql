-- Per-agent pinned chat model ("provider/model", e.g. "anthropic/claude-sonnet-5").
-- NULL means the agent inherits the chat's selected model / routing default.
ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "model" varchar(120);
