import { withAuth } from "auth/route-guard";
import { userRepository } from "lib/db/repository";
import { requireFeature } from "@/lib/gate";

/**
 * Get user's local models configuration
 *
 * GET /api/user/local-models/config
 *
 * NOTE: apiKey is intentionally stripped from the response.
 * The client only receives hasApiKey (boolean) to avoid leaking secrets.
 */
export const GET = withAuth(async (_request, session) => {
  const preferences = await userRepository.getPreferences(session.user.id);
  const config = preferences?.localModels;

  if (!config) {
    return Response.json({ config: null });
  }

  // Strip apiKey — never expose raw secret to the client
  const { apiKey, ...safeConfig } = config;

  return Response.json({
    config: { ...safeConfig, hasApiKey: !!apiKey },
  });
});

/**
 * Save user's local models configuration
 *
 * POST /api/user/local-models/config
 * Body: { baseUrl: string, type: string, models: Array<Model>, apiKey?: string }
 */
export const POST = withAuth(async (request: Request, session) => {
  // Check subscription
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

  const { baseUrl, type, models, apiKey } = await request.json();

  // Validate input
  if (!baseUrl || !type || !models || !Array.isArray(models)) {
    return Response.json(
      { error: "Invalid configuration data" },
      { status: 400 },
    );
  }

  if (!["ollama", "lmstudio", "openai_compatible"].includes(type)) {
    return Response.json(
      {
        error:
          "Invalid type. Must be 'ollama', 'lmstudio', or 'openai_compatible'",
      },
      { status: 400 },
    );
  }

  if (type === "openai_compatible" && !apiKey) {
    return Response.json(
      { error: "API key is required for OpenAI-compatible servers" },
      { status: 400 },
    );
  }

  // Save to user preferences (apiKey stored server-side in per-user JSONB)
  const currentPreferences = await userRepository.getPreferences(
    session.user.id,
  );

  await userRepository.updatePreferences(session.user.id, {
    ...currentPreferences,
    localModels: {
      enabled: true,
      type,
      baseUrl,
      ...(apiKey ? { apiKey } : {}),
      models,
      lastSync: new Date().toISOString(),
    },
  });

  return Response.json({ success: true });
});

/**
 * Delete user's local models configuration
 *
 * DELETE /api/user/local-models/config
 */
export const DELETE = withAuth(async (_request, session) => {
  const currentPreferences = await userRepository.getPreferences(
    session.user.id,
  );

  await userRepository.updatePreferences(session.user.id, {
    ...currentPreferences,
    localModels: undefined,
  });

  return Response.json({ success: true });
});
