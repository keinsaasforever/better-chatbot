-- Create models table for rich metadata and pricing
CREATE TABLE IF NOT EXISTS "models" (
  "model" text PRIMARY KEY NOT NULL,
  "developer" text NOT NULL,
  "text" boolean DEFAULT false NOT NULL,
  "vision" boolean DEFAULT false NOT NULL,
  "audio" boolean DEFAULT false NOT NULL,
  "hidden_gem" boolean DEFAULT false NOT NULL,
  "caution" boolean DEFAULT false NOT NULL,
  "not_recommended" boolean DEFAULT false NOT NULL,
  "cheap_alternative" boolean DEFAULT false NOT NULL,
  "speed" boolean DEFAULT false NOT NULL,
  "thinking" boolean DEFAULT false NOT NULL,
  "max_performance" boolean DEFAULT false NOT NULL,
  "input_price_usd" numeric(20,10),
  "output_price_usd" numeric(20,10),
  "context_tokens" integer,
  "description" text,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS "idx_models_developer" ON "models"("developer");
CREATE INDEX IF NOT EXISTS "idx_models_text" ON "models"("text") WHERE "text" = true;
CREATE INDEX IF NOT EXISTS "idx_models_badges" ON "models"("hidden_gem", "speed", "thinking");
CREATE INDEX IF NOT EXISTS "idx_models_model" ON "models"("model");












