import { withAuth } from "auth/route-guard";
import { requireFeature } from "@/lib/gate";

/**
 * Auto-discover models from user's Ollama, LM Studio, or OpenAI-compatible instance
 *
 * POST /api/user/local-models/discover
 * Body: { baseUrl: string, type?: string, apiKey?: string }
 *
 * Returns:
 *   { type: "ollama" | "lmstudio" | "openai_compatible", models: Array<Model>, baseUrl: string }
 */
export const POST = withAuth(async (request: Request, _session) => {
  // Check if user has subscription
  try {
    await requireFeature("local_models");
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Subscription required",
      },
      { status: 403 },
    );
  }

  const { baseUrl, type, apiKey } = await request.json();

  if (!baseUrl) {
    return Response.json({ error: "baseUrl is required" }, { status: 400 });
  }

  // For openai_compatible, API key is required
  if (type === "openai_compatible" && !apiKey) {
    return Response.json(
      { error: "API key is required for OpenAI-compatible servers" },
      { status: 400 },
    );
  }

  try {
    const result =
      type === "openai_compatible"
        ? await discoverOpenAICompatible(baseUrl, apiKey)
        : await discoverLocalModels(baseUrl);
    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to discover models",
      },
      { status: 400 },
    );
  }
});

/**
 * Discover models from an OpenAI-compatible server (e.g. Xinity) that requires an API key.
 * Uses GET /v1/models with Authorization: Bearer <apiKey>
 */
async function discoverOpenAICompatible(baseUrl: string, apiKey: string) {
  const normalizedUrl = baseUrl.replace(/\/$/, "");

  let response: Response;
  try {
    response = await fetch(`${normalizedUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
  } catch (fetchErr: any) {
    const msg = fetchErr?.message ?? String(fetchErr);
    throw new Error(
      `fetch failed: Cannot reach ${normalizedUrl} from the server. ` +
        "If your Xinity instance is on a local network, it is not reachable from the cloud. " +
        "Use a public URL (tunnel/VPN), or enter model IDs manually. " +
        `(${msg})`,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      "Authentication failed. Please check your API key and try again.",
    );
  }

  if (!response.ok) {
    throw new Error(
      `Cannot connect to server at this URL (HTTP ${response.status}). Make sure the server is running and the URL is correct.`,
    );
  }

  const data = await response.json();
  const models = data.data || [];

  if (!Array.isArray(models)) {
    throw new Error(
      "Unexpected response from server. Is this an OpenAI-compatible API?",
    );
  }

  if (models.length === 0) {
    throw new Error(
      "Connected successfully but no models are available on this server.",
    );
  }

  return {
    type: "openai_compatible" as const,
    baseUrl: normalizedUrl,
    models: models.map((m: any) => ({
      id: m.id,
      name: m.id,
    })),
  };
}

/**
 * Try to discover models from Ollama or LM Studio (auto-detects, no API key)
 */
async function discoverLocalModels(baseUrl: string) {
  // Normalize URL (remove trailing slash)
  const normalizedUrl = baseUrl.replace(/\/$/, "");

  // Try Ollama first (GET /api/tags)
  try {
    const response = await fetch(`${normalizedUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json();
      // Validate it's actually Ollama by checking for "models" array
      if (data && Array.isArray(data.models)) {
        const models = data.models;

        return {
          type: "ollama" as const,
          baseUrl: normalizedUrl,
          models: models.map((m: any) => ({
            id: m.name || m.model,
            name: m.name || m.model,
            size: m.size,
            details: m.details,
          })),
        };
      }
      // If no valid models array, fall through to try LM Studio
    }
  } catch (_error) {
    // Continue to try LM Studio
  }

  // Try LM Studio (GET /v1/models - OpenAI-compatible, no auth)
  try {
    const response = await fetch(`${normalizedUrl}/v1/models`, {
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json();
      const models = data.data || [];

      // Check if it's valid LM Studio response with models
      if (Array.isArray(models)) {
        if (models.length === 0) {
          throw new Error(
            "✅ Connected to LM Studio successfully!\n\n" +
              "❌ But no models are loaded.\n\n" +
              "To fix:\n" +
              "1. Open LM Studio\n" +
              "2. Go to 'Local Server' tab\n" +
              "3. Select a model from the dropdown\n" +
              "4. Make sure it shows 'Server Running'\n" +
              "5. Try discovering again",
          );
        }

        return {
          type: "lmstudio" as const,
          baseUrl: normalizedUrl,
          models: models.map((m: any) => ({
            id: m.id,
            name: m.id,
          })),
        };
      }
    }
  } catch (error) {
    // If it's our custom "no models" error, re-throw it
    if (
      error instanceof Error &&
      error.message.includes("Connected to LM Studio")
    ) {
      throw error;
    }
    // Otherwise continue to final error
  }

  throw new Error(
    "Cannot connect to Ollama or LM Studio at this URL. Make sure the service is running.\n\n" +
      "Default ports:\n" +
      "- Ollama: http://localhost:11434\n" +
      "- LM Studio: http://localhost:1234",
  );
}
