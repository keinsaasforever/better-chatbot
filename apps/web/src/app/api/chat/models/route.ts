import { checkFeature } from "@/lib/gate";
import { getSession } from "auth/server";
import { customModelProvider } from "lib/ai/models";
import {
  getAvailableOrganizationModels,
  isRoutingSchemaUnavailableError,
} from "lib/ai/routing/service";
import { serverCache } from "lib/cache";
import { userRepository } from "lib/db/repository";
import equal from "lib/equal";
import { after } from "next/server";

// Live local-model discovery is rate-limited to at most once per this window per
// user (see the cache marker below), so a page that polls /api/chat/models does
// not hammer the user's local instance or the preferences table.
const LOCAL_MODEL_DISCOVERY_TTL_MS = 5 * 60 * 1000;

/**
 * Auto-discover models from user's configured local instance
 * Called on every page load - keeps models in sync automatically
 */
async function discoverAndUpdateLocalModels(userId: string, config: any) {
  if (!config?.enabled || !config.baseUrl) return null;

  const normalizedUrl = config.baseUrl.replace(/\/$/, "");
  let models: any[] = [];

  try {
    if (config.type === "ollama") {
      const response = await fetch(`${normalizedUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        const data = await response.json();
        models = (data.models || []).map((m: any) => ({
          id: m.name || m.model,
          name: m.name || m.model,
          size: m.size,
          details: m.details,
        }));
      }
    } else if (config.type === "lmstudio") {
      const response = await fetch(`${normalizedUrl}/v1/models`, {
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        const data = await response.json();
        models = (data.data || []).map((m: any) => ({
          id: m.id,
          name: m.id,
        }));
      }
    } else if (config.type === "openai_compatible") {
      const headers: Record<string, string> = {};
      if (config.apiKey) {
        headers["Authorization"] = `Bearer ${config.apiKey}`;
      }
      const response = await fetch(`${normalizedUrl}/v1/models`, {
        headers,
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        const data = await response.json();
        models = (data.data || []).map((m: any) => ({
          id: m.id,
          name: m.id,
        }));
      }
    }

    // Persist the fresh list only when it actually changed, so a steady-state
    // instance (same models each poll) is not a preferences write per request.
    if (models.length > 0 && !equal(models, config.models)) {
      const preferences = await userRepository.getPreferences(userId);
      await userRepository.updatePreferences(userId, {
        ...preferences,
        localModels: {
          ...config,
          models,
          lastSync: new Date().toISOString(),
        },
      });
    }

    // If live discovery returned nothing (non-throwing failure — e.g. non-ok
    // response, empty data, server unreachable but fetch didn't throw), fall
    // back to the cached model list so the selector stays populated.
    return models.length > 0 ? models : config.models || [];
  } catch (error) {
    console.warn("Local model discovery failed, using cached list:", error);
    return config.models || [];
  }
}

/**
 * Get available models for current user
 *
 * GET /api/chat/models
 */
export const GET = async () => {
  const session = await getSession();

  const activeOrganizationId = (
    session?.session as { activeOrganizationId?: string | null } | undefined
  )?.activeOrganizationId;

  // Get base system models
  const baseModels = customModelProvider.modelsInfo;

  // FILTER OUT providers we don't want to show
  let filteredModels = baseModels.filter(
    (p) => p.provider !== "ollama" && p.provider !== "groq",
  );

  // The static catalog is the source of truth for what the product ships. Any
  // org-enabled deployment whose provider isn't in it is a retired/legacy row
  // left over from an earlier lineup and must not leak back into the menu.
  // (Deployments for a provider that IS shipped are still matched per model
  // name below, so a retired model under a live provider is dropped too.)
  const catalogProviders = new Set(filteredModels.map((p) => p.provider));

  if (session?.user?.id && activeOrganizationId) {
    try {
      const { models } = await getAvailableOrganizationModels({
        organizationId: activeOrganizationId,
        userId: session.user.id,
      });
      const allowedByProvider = new Map<string, Set<string>>();
      for (const model of models) {
        const entries =
          allowedByProvider.get(model.provider) ?? new Set<string>();
        entries.add(model.model);
        allowedByProvider.set(model.provider, entries);
      }
      filteredModels = filteredModels
        .map((provider) => ({
          ...provider,
          models: provider.models.filter((model) =>
            allowedByProvider.get(provider.provider)?.has(model.name),
          ),
        }))
        .filter((provider) => provider.models.length > 0);

      for (const [provider, modelNames] of allowedByProvider) {
        if (!catalogProviders.has(provider)) {
          // Retired/legacy deployment for a provider the product no longer
          // ships — keep it out of the selector.
          continue;
        }
        if (filteredModels.some((entry) => entry.provider === provider)) {
          continue;
        }
        filteredModels.push({
          provider,
          hasAPIKey:
            provider !== "TensorX" ||
            Boolean(
              process.env.TENSORX_API_KEY &&
                process.env.TENSORX_API_KEY !== "****",
            ),
          models: [...modelNames].map((name) => ({
            name,
            isToolCallUnsupported: false,
            isImageInputUnsupported: true,
            supportedFileMimeTypes: [],
          })),
        });
      }
    } catch (error) {
      if (!isRoutingSchemaUnavailableError(error)) {
        throw error;
      }
      console.error(
        "Model-routing tables are not migrated; returning the base model catalog.",
      );
    }
  }

  // Check if user has Local Models configured. Local models live in per-user
  // preferences (never in model_deployment), so they are independent of the
  // active organization and must be offered to org members too — not only to
  // users without an active org.
  let localModelsProvider: any = null;
  let showAddLocalModelsButton = false;

  if (session?.user?.id) {
    const [preferences, hasAccess] = await Promise.all([
      userRepository.getPreferences(session.user.id),
      checkFeature("local_models"),
    ]);
    const config = preferences?.localModels;

    if (hasAccess && config?.enabled && config.baseUrl) {
      // Live discovery hits the user's local instance (up to a 3s timeout) and
      // can write preferences, so gate it to once per TTL per user via a cache
      // marker. Between refreshes serve the cached model list and refresh in the
      // background so the request never blocks on the instance.
      const userId = session.user.id;
      const discoveryKey = `local-models-discovery:${userId}`;
      let models: typeof config.models = config.models ?? [];

      if (!(await serverCache.has(discoveryKey))) {
        await serverCache.set(discoveryKey, true, LOCAL_MODEL_DISCOVERY_TTL_MS);
        if (models.length > 0) {
          // Cached list available: return it now, refresh after the response.
          after(() => discoverAndUpdateLocalModels(userId, config));
        } else {
          // No cached list yet (first configuration): discover synchronously so
          // the selector isn't empty on first open.
          models = (await discoverAndUpdateLocalModels(userId, config)) ?? [];
        }
      }

      if (models && models.length > 0) {
        localModelsProvider = {
          provider: "Local Models",
          hasAPIKey: true,
          models: models.map((m) => ({
            name: m.name,
            isToolCallUnsupported: false,
            isImageInputUnsupported: true,
            supportedFileMimeTypes: [],
          })),
          metadata: {
            type: config.type,
            baseUrl: config.baseUrl,
            lastSync: new Date().toISOString(),
          },
        };
      }
    } else {
      // Missing/expired entitlement or no configuration: offer subscribe/setup.
      showAddLocalModelsButton = true;
    }
  }

  // Build final models list
  const allModels: any[] = [...filteredModels];

  if (localModelsProvider) {
    allModels.push(localModelsProvider);
  } else if (showAddLocalModelsButton) {
    // Add placeholder entry that triggers LocalModelsDialog
    allModels.push({
      provider: "Add Local Models", // Shows as button text
      hasAPIKey: false, // Not configured yet
      models: [], // Empty - UI will render custom button
      isPlaceholder: true, // Special flag for UI to render button
    });
  }

  // Sort: Navigator first, then by API key availability
  return Response.json(
    allModels.sort((a, b) => {
      if (a.provider === "Navigator") return -1;
      if (b.provider === "Navigator") return 1;
      if (a.hasAPIKey && !b.hasAPIKey) return -1;
      if (!a.hasAPIKey && b.hasAPIKey) return 1;
      return 0;
    }),
  );
};
