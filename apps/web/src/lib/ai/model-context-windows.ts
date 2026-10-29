/**
 * Static catalog of model context-window sizes, keyed "provider/model" to
 * match ChatModel ({ provider, model }) and the gateway ids in
 * lib/ai/models.ts. Client-safe on purpose (models.ts is server-only): the
 * composer meter looks windows up from message metadata, including models
 * that are no longer selectable. Values are best-effort from provider docs;
 * unknown models (Local Models, openai-compatible) simply miss the map and
 * the meter stays hidden.
 */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // Navigator's base model is `zai/glm-5.3-flash`.
  "Navigator/Base model": 1_000_000,
  // TensorX (direct EU endpoint)
  "TensorX/kimi-k3": 1_048_576,
  "TensorX/qwen3.8-2.4t-a95b": 1_048_576,
  "TensorX/minimax-m2": 204_800,
  "anthropic/claude-sonnet-5": 200_000,
  "anthropic/claude-opus-4.8": 200_000,
  "anthropic/claude-fable-5": 200_000,
  "deepseek/deepseek-r1": 131_072,
  "deepseek/deepseek-v3.2": 131_072,
  "google/gemini-2.5-flash": 1_048_576,
  "google/gemini-3.1-pro-preview": 1_048_576,
  "mistral/mistral-large-3": 131_072,
  "mistral/magistral-small": 40_000,
  "mistral/devstral-2": 131_072,
  "moonshotai/kimi-k2.6": 262_144,
  "moonshotai/kimi-k3": 262_144,
  "openai/gpt-5.6-sol": 400_000,
  "openai/gpt-5.6-terra": 400_000,
  "openai/gpt-5.6-luna": 400_000,
  "zai/glm-5.2": 200_000,
  "alibaba/qwen3.7-max": 262_144,
  "alibaba/qwen3.7-plus": 1_000_000,
  "xai/grok-4.5": 262_144,
  "xai/grok-4.3": 262_144,
  "ollama/gemma3:1b": 32_768,
  "ollama/gemma3:4b": 131_072,
  "ollama/gemma3:12b": 131_072,
  "groq/gpt-oss-120b": 131_072,
};

export function getContextWindow(model?: {
  provider: string;
  model: string;
}): number | undefined {
  if (!model) return undefined;
  return MODEL_CONTEXT_WINDOWS[`${model.provider}/${model.model}`];
}

export function percentUsed(used: number, max: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((used / max) * 100)));
}

export function formatTokenCount(count: number): string {
  if (count < 1_000) return `${count}`;
  if (count < 1_000_000) {
    const k = count / 1_000;
    return `${k >= 100 ? Math.round(k) : Math.round(k * 10) / 10}K`;
  }
  const m = count / 1_000_000;
  return `${m >= 100 ? Math.round(m) : Math.round(m * 10) / 10}M`;
}
