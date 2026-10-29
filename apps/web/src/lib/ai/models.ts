import "server-only";

// ✅ Register AI Gateway provider globally (MUST be first import)
// This registers the gateway provider at module load time, ensuring it's
// initialized once and reused across all requests. This eliminates per-request
// provider initialization overhead (~500-1000ms savings per request).
import "./register-gateway-provider";

// AI Gateway: No need to import @ai-sdk/openai, @ai-sdk/google, etc.
// These are now handled by AI Gateway using string model IDs
import { createGroq } from "@ai-sdk/groq";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { LanguageModel } from "ai";
import { ChatModel } from "app-types/chat";
import { userRepository } from "lib/db/repository";
import { createOllama } from "ollama-ai-provider-v2";
import {
  createOpenAICompatibleModels,
  openaiCompatibleModelsSafeParse,
} from "./create-openai-compatiable";
import {
  ANTHROPIC_FILE_MIME_TYPES,
  DEFAULT_FILE_PART_MIME_TYPES,
  GEMINI_FILE_MIME_TYPES,
  OPENAI_FILE_MIME_TYPES,
  XAI_FILE_MIME_TYPES,
} from "./file-support";
import { getTensorXModel } from "./providers/tensorx";
import { isAiGatewayConfigured } from "./speech/voice-realtime-config";

const ollama = createOllama({
  baseURL: process.env.OLLAMA_BASE_URL || "http://localhost:11434/api",
});
const groq = createGroq({
  baseURL: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
  apiKey: process.env.GROQ_API_KEY,
});

/**
 * TensorX deployments (EU, zero inference-content retention).
 *
 * Keys are the menu names, values the TensorX provider model ids. Unlike the
 * AI Gateway entries these must never reach the AI SDK as bare strings: a
 * string is resolved by the globally registered gateway provider, which would
 * silently move the request off the audited zero-retention TensorX path. Both
 * `getModel` and `getModelInstance` go through `resolveTensorXModel` instead.
 *
 * The values double as the capability keys below — `moonshotai/kimi-k3` is the
 * same id the gateway entry uses, so image/file support registered there
 * applies here too.
 */
const tensorxProviderModelIds: Record<string, string> = {
  "kimi-k3": "moonshotai/kimi-k3",
  "qwen3.8-2.4t-a95b": "qwen/qwen3.8-2.4t-a95b",
  "minimax-m2": "minimax/minimax-m2",
};

const resolveTensorXModel = (modelName: string): LanguageModel => {
  const providerModelId = tensorxProviderModelIds[modelName];
  if (!providerModelId) {
    throw new Error(`Unknown TensorX model "${modelName}"`);
  }
  return getTensorXModel(providerModelId);
};

const staticModels = {
  // Navigator (Z.ai GLM 5.3 Flash via AI Gateway) - Primary model.
  //
  // Was `moonshotai/kimi-k2.5`, which announce-and-stopped: it called one tool,
  // wrote "Now let me fetch…", and finished the turn on `finishReason: "stop"`
  // with nine steps of budget left, ignoring the three separate rules against
  // that in `lib/ai/prompts.ts`. Back-to-back turns on the same prompt and the
  // same MCP server chained correctly on kimi-k3 (4 steps) and claude-sonnet-5
  // (3 steps), so the loop was never the problem — the model was.
  Navigator: {
    "Base model": "zai/glm-5.3-flash",
  },
  // Direct TensorX path (see `resolveTensorXModel`) — not an AI Gateway group.
  TensorX: tensorxProviderModelIds,
  anthropic: {
    "claude-sonnet-5": "anthropic/claude-sonnet-5",
    "claude-opus-4.8": "anthropic/claude-opus-4.8",
    "claude-fable-5": "anthropic/claude-fable-5",
  },
  deepseek: {
    "deepseek-r1": "deepseek/deepseek-r1",
    "deepseek-v3.2": "deepseek/deepseek-v3.2",
  },
  google: {
    "gemini-2.5-flash": "google/gemini-2.5-flash",
    "gemini-3.1-pro-preview": "google/gemini-3.1-pro-preview",
    // embedding (not visible in UI)
    "gemini-embedding-001": "google/gemini-embedding-001",
    // image (not visible in UI)
    "gemini-2.5-flash-image": "google/gemini-2.5-flash-image",
  },
  mistral: {
    "mistral-large-3": "mistral/mistral-large-3",
    "magistral-small": "mistral/magistral-small",
    "devstral-2": "mistral/devstral-2",
    // embedding (not visible in UI)
    "mistral-embed": "mistral/mistral-embed",
  },
  moonshotai: {
    "kimi-k2.6": "moonshotai/kimi-k2.6",
    "kimi-k3": "moonshotai/kimi-k3",
  },
  openai: {
    // GPT-5.6 family: Sol (flagship), Terra (balanced), Luna (fast/cheap)
    "gpt-5.6-sol": "openai/gpt-5.6-sol",
    "gpt-5.6-terra": "openai/gpt-5.6-terra",
    "gpt-5.6-luna": "openai/gpt-5.6-luna",
    // embedding (not visible in UI)
    "text-embedding-3-small": "openai/text-embedding-3-small",
    "text-embedding-3-large": "openai/text-embedding-3-large",
    // image (not visible in UI)
    "gpt-5-nano": "openai/gpt-5-nano",
    "gpt-5": "openai/gpt-5",
  },
  zai: {
    "glm-5.2": "zai/glm-5.2",
  },
  alibaba: {
    "qwen3.7-max": "alibaba/qwen3.7-max",
    "qwen3.7-plus": "alibaba/qwen3.7-plus",
  },
  cohere: {
    // embedding (not visible in UI)
    "embed-v4.0": "cohere/embed-v4.0",
  },
  xai: {
    "grok-4.5": "xai/grok-4.5",
    "grok-4.3": "xai/grok-4.3",
  },
  // Separate services (keep SDK format)
  ollama: {
    "gemma3:1b": ollama("gemma3:1b"),
    "gemma3:4b": ollama("gemma3:4b"),
    "gemma3:12b": ollama("gemma3:12b"),
  },
  // Groq inference provider (for Groq-hosted models)
  groq: {
    "gpt-oss-120b": groq("openai/gpt-oss-120b"),
  },
};

// Models that should not be visible in the UI (embedding and image generation models)
const hiddenModels = new Set([
  // Embedding models
  staticModels.google["gemini-embedding-001"],
  staticModels.mistral["mistral-embed"],
  staticModels.openai["text-embedding-3-small"],
  staticModels.openai["text-embedding-3-large"],
  staticModels.cohere["embed-v4.0"],
  // Image generation models
  staticModels.google["gemini-2.5-flash-image"],
  staticModels.openai["gpt-5-nano"],
  staticModels.openai["gpt-5"],
]);

const staticUnsupportedModels = new Set([
  staticModels.ollama["gemma3:1b"],
  staticModels.ollama["gemma3:4b"],
  staticModels.ollama["gemma3:12b"],
]);

// List of model IDs that support image input (now strings from AI Gateway)
const staticSupportImageInputModelIds = new Set([
  // Google models
  staticModels.google["gemini-2.5-flash"],
  staticModels.google["gemini-3.1-pro-preview"],
  // Anthropic models
  staticModels.anthropic["claude-sonnet-5"],
  staticModels.anthropic["claude-opus-4.8"],
  staticModels.anthropic["claude-fable-5"],
  // OpenAI models
  staticModels.openai["gpt-5.6-sol"],
  staticModels.openai["gpt-5.6-terra"],
  staticModels.openai["gpt-5.6-luna"],
  // Navigator's base model (Z.ai GLM)
  staticModels.Navigator["Base model"],
  // Moonshot AI models
  staticModels.moonshotai["kimi-k2.6"],
  staticModels.moonshotai["kimi-k3"],
  // xAI models
  staticModels.xai["grok-4.5"],
  staticModels.xai["grok-4.3"],
  // Alibaba models (Qwen 3.7 Plus supports vision input)
  staticModels.alibaba["qwen3.7-plus"],
  // TensorX serves the same Kimi K3 weights under the same provider model id,
  // so this entry (and the file support registered below) covers both paths.
  staticModels.TensorX["kimi-k3"],
]);

const staticFilePartSupportByModel = new Map<
  LanguageModel,
  readonly string[]
>();

const registerFileSupport = (
  model: LanguageModel | undefined,
  mimeTypes: readonly string[] = DEFAULT_FILE_PART_MIME_TYPES,
) => {
  if (!model) return;
  staticFilePartSupportByModel.set(model, Array.from(mimeTypes));
};

// OpenAI file support
registerFileSupport(staticModels.openai["gpt-5.6-sol"], OPENAI_FILE_MIME_TYPES);
registerFileSupport(
  staticModels.openai["gpt-5.6-terra"],
  OPENAI_FILE_MIME_TYPES,
);
registerFileSupport(
  staticModels.openai["gpt-5.6-luna"],
  OPENAI_FILE_MIME_TYPES,
);

// Google file support
registerFileSupport(
  staticModels.google["gemini-2.5-flash"],
  GEMINI_FILE_MIME_TYPES,
);
registerFileSupport(
  staticModels.google["gemini-3.1-pro-preview"],
  GEMINI_FILE_MIME_TYPES,
);

// Anthropic file support
registerFileSupport(
  staticModels.anthropic["claude-sonnet-5"],
  ANTHROPIC_FILE_MIME_TYPES,
);
registerFileSupport(
  staticModels.anthropic["claude-opus-4.8"],
  ANTHROPIC_FILE_MIME_TYPES,
);
registerFileSupport(
  staticModels.anthropic["claude-fable-5"],
  ANTHROPIC_FILE_MIME_TYPES,
);

// xAI file support
registerFileSupport(staticModels.xai["grok-4.5"], XAI_FILE_MIME_TYPES);
registerFileSupport(staticModels.xai["grok-4.3"], XAI_FILE_MIME_TYPES);

// Navigator base model file support
registerFileSupport(
  staticModels.Navigator["Base model"],
  DEFAULT_FILE_PART_MIME_TYPES,
);

// Moonshot AI file support
registerFileSupport(
  staticModels.moonshotai["kimi-k2.6"],
  DEFAULT_FILE_PART_MIME_TYPES,
);
registerFileSupport(
  staticModels.moonshotai["kimi-k3"],
  DEFAULT_FILE_PART_MIME_TYPES,
);

const openaiCompatibleProviders = openaiCompatibleModelsSafeParse(
  process.env.OPENAI_COMPATIBLE_DATA,
);

const {
  providers: openaiCompatibleModels,
  unsupportedModels: openaiCompatibleUnsupportedModels,
} = createOpenAICompatibleModels(openaiCompatibleProviders);

const allModels = { ...openaiCompatibleModels, ...staticModels };

const allUnsupportedModels = new Set([
  ...openaiCompatibleUnsupportedModels,
  ...staticUnsupportedModels,
]);

export const isToolCallUnsupportedModel = (model: LanguageModel | string) => {
  // For string models (AI Gateway), check if it's in the unsupported set
  if (typeof model === "string") {
    return Array.from(allUnsupportedModels).some(
      (m) => typeof m === "string" && m === model,
    );
  }
  return allUnsupportedModels.has(model);
};

const isImageInputUnsupportedModel = (model: LanguageModel | string) => {
  // For string models (AI Gateway), check if it's in the supported image models set
  if (typeof model === "string") {
    return !staticSupportImageInputModelIds.has(model);
  }
  // For SDK instances, assume not supported unless it's in the set
  return true;
};

export const getFilePartSupportedMimeTypes = (model: LanguageModel) => {
  return staticFilePartSupportByModel.get(model) ?? [];
};

/**
 * Whether the model that will actually run this turn accepts image input.
 *
 * Decides whether an attached PDF is rendered to page images for the model
 * (see `lib/ai/ingest/pdf-rasterize.ts`).
 *
 * Resolution goes through `getModel`, so an absent or unknown id reports the
 * capability of the fallback model it will be served by, not `false`. Asking
 * about the requested id instead would skip rendering on exactly the turns
 * that silently run on the vision-capable fallback.
 *
 * A model supplied as an SDK instance (Local Models, Ollama, Groq) is treated
 * as text-only: there is no id to check, and the cost of guessing wrong is a
 * rejected request rather than a slightly worse answer.
 */
export const supportsImageInput = (model?: ChatModel): boolean => {
  const resolved = customModelProvider.getModel(model);
  return (
    typeof resolved === "string" && !isImageInputUnsupportedModel(resolved)
  );
};

/**
 * AI Gateway ID for workflow video → process text (upload / screen recording).
 * Matches `staticModels.google["gemini-3.1-pro-preview"]`; override with
 * `NAVIGATOR_SCREEN_VIDEO_MODEL` in the analyze-video route.
 */
export const defaultNavigatorScreenVideoModelId =
  staticModels.google["gemini-3.1-pro-preview"];

/**
 * Model used by the project-brain pipeline: the tool-sync agent that pulls data
 * from connected tools and the extraction step that generates the To-dos /
 * Progress widget data. Runs on the Navigator base model.
 */
export const projectBrainModelId = staticModels.Navigator["Base model"];

const fallbackModel = staticModels.openai["gpt-5.6-terra"]; // "openai/gpt-5.6-terra"

export const customModelProvider = {
  modelsInfo: Object.entries(allModels).map(([provider, models]) => ({
    provider,
    models: Object.entries(models)
      .filter(([_name, model]) => !hiddenModels.has(model)) // Filter out embedding and image models
      .map(([name, model]) => ({
        name,
        isToolCallUnsupported: isToolCallUnsupportedModel(model),
        isImageInputUnsupported: isImageInputUnsupportedModel(model),
        supportedFileMimeTypes: [...getFilePartSupportedMimeTypes(model)],
      })),
    hasAPIKey: checkProviderAPIKey(provider as keyof typeof staticModels),
  })),
  getModel: (model?: ChatModel): LanguageModel | string => {
    if (!model) return fallbackModel;
    // Returning the raw catalog value here would hand the gateway provider a
    // TensorX model id. Resolve the direct client instead so zero-retention
    // traffic stays on the configured TensorX endpoint (see getModelInstance).
    if (model.provider === "TensorX") return resolveTensorXModel(model.model);
    const resolved = allModels[model.provider]?.[model.model];
    if (!resolved) {
      // Falling back is deliberate (never fail a chat over a stale model id),
      // but a caller that hardcodes an id we do not register would otherwise
      // run on the fallback forever without a trace. Surface it outside prod.
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          `[models] unknown model "${model.provider}/${model.model}" - using fallback "${fallbackModel}"`,
        );
      }
      return fallbackModel;
    }
    return resolved;
  },
};

function checkProviderAPIKey(provider: keyof typeof staticModels) {
  let key: string | undefined;
  switch (provider) {
    case "openai":
    case "google":
    case "anthropic":
    case "xai":
    case "Navigator":
    case "deepseek":
    case "mistral":
    case "moonshotai":
    case "zai":
    case "alibaba":
    case "cohere":
      // AI Gateway providers - use AI_GATEWAY_API_KEY, or the deployment's
      // OIDC token on Vercel
      return isAiGatewayConfigured();
    case "TensorX":
      // Direct provider — never the gateway key.
      key = process.env.TENSORX_API_KEY;
      break;
    case "groq":
      key = process.env.GROQ_API_KEY;
      break;
    case "ollama":
      // Ollama requires a base URL to be configured
      key = process.env.OLLAMA_BASE_URL;
      break;
    default:
      return true; // assume the provider has an API key
  }
  return !!key && key != "****";
}

/**
 * Cache for user-specific provider instances
 * Key format: "userId:baseUrl:type"
 *
 * Why cache?
 * - createOllama/createOpenAI are lightweight (~1ms) but called on EVERY chat message
 * - With cache: 0ms overhead after first request
 * - Cache invalidated when user changes URL (natural - new URL = new key)
 */
const localProviderCache = new Map<string, any>();

/**
 * Get or create cached provider instance
 *
 * Cache key includes apiKey so rotating the key automatically creates a new provider.
 */
function getOrCreateLocalProvider(
  userId: string,
  type: "ollama" | "lmstudio" | "openai_compatible",
  baseUrl: string,
  apiKey?: string,
) {
  // Include a hash of apiKey in cache key so rotation invalidates the cache
  const cacheKey = `${userId}:${baseUrl}:${type}:${apiKey ?? ""}`;

  // Check cache first (0ms overhead)
  let provider = localProviderCache.get(cacheKey);

  if (!provider) {
    // Create new instance (only happens once per user+URL+key)
    const normalizedUrl = baseUrl.replace(/\/$/, "");

    if (type === "ollama") {
      provider = createOllama({
        baseURL: `${normalizedUrl}/api`,
      });
    } else if (type === "lmstudio") {
      provider = createOpenAICompatible({
        name: "lmstudio",
        baseURL: `${normalizedUrl}/v1`,
        apiKey: "not-needed",
      });
    } else if (type === "openai_compatible") {
      provider = createOpenAICompatible({
        name: "xinity",
        baseURL: `${normalizedUrl}/v1`,
        apiKey: apiKey ?? "not-needed",
      });
    }

    localProviderCache.set(cacheKey, provider);
  }

  return provider;
}

/**
 * Get model instance - handles Local Models provider dynamically
 *
 * IMPORTANT: Use this instead of customModelProvider.getModel() in chat API
 *
 * Flow:
 * 1. User selects "llama3.2:latest" from "Local Models" provider
 * 2. Chat API receives: { provider: "Local Models", model: "llama3.2:latest" }
 * 3. This function gets cached provider OR creates new one (first time only)
 * 4. Returns: ollama("llama3.2:latest") with user's baseURL
 *
 * For all other providers (openai, anthropic, etc.):
 * - Falls back to existing static models lookup
 */
export async function getModelInstance(
  modelData?: ChatModel,
  userId?: string,
): Promise<LanguageModel | string> {
  // Handle undefined model
  if (!modelData) return fallbackModel;

  // TensorX is deliberately direct rather than routed through AI Gateway so
  // its audited retention path remains the configured TensorX endpoint.
  if (modelData.provider === "TensorX") {
    return resolveTensorXModel(modelData.model);
  }

  // SPECIAL CASE: Local Models provider (doesn't exist in allModels)
  if (modelData.provider === "Local Models") {
    if (!userId) {
      throw new Error("User ID required for Local Models");
    }

    const preferences = await userRepository.getPreferences(userId);
    const config = preferences?.localModels;

    if (!config?.enabled || !config.baseUrl) {
      throw new Error("Local models not configured");
    }

    // Get cached provider (0ms after first call)
    const provider = getOrCreateLocalProvider(
      userId,
      config.type,
      config.baseUrl,
      config.apiKey,
    );

    // Return model instance
    return provider(modelData.model); // e.g., "llama3.2:latest"
  }

  // EXISTING BEHAVIOR: Use static models lookup
  // This handles: openai, anthropic, google, ollama (old), groq, etc.
  return customModelProvider.getModel(modelData);
}
