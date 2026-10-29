import "server-only";
import type { Tool } from "ai";
import { generateObject } from "ai";
import { z } from "zod";
import { composio } from "@/lib/composio/client";
import { getModelInstance } from "@/lib/ai/models";
import globalLogger from "logger";
import { aiTelemetry } from "lib/ai/telemetry";

const logger = globalLogger.withDefaults({ message: "Composio Scoped: " });

/** Navigator base model, by alias so a base-model swap carries here. */
const DERIVE_MODEL = { provider: "Navigator", model: "Base model" } as const;

type ToolkitRef = { slug: string; name?: string };

/** List the toolkits Composio reports as connected for this user. */
export async function listConnectedToolkits(
  userId: string,
): Promise<ToolkitRef[]> {
  try {
    const session = await composio.create(userId);
    const page = await session.toolkits({ limit: 100 });
    const items = (page?.items ?? []) as Array<{
      slug?: string;
      name?: string;
      connection?: { isActive?: boolean };
    }>;
    return items
      .filter((t) => t.slug && t.connection?.isActive !== false)
      .map((t) => ({ slug: t.slug as string, name: t.name }));
  } catch (error) {
    logger.warn("Failed to list toolkits:", error);
    return [];
  }
}

/**
 * Map a project's system prompt to the subset of the user's connected Composio
 * toolkits that are relevant. Returns toolkit slugs to cache on the project.
 * Conservative: returns [] on any failure (fail closed for project runs).
 */
export async function deriveComposioToolkits(input: {
  userId: string;
  systemPrompt: string | null | undefined;
}): Promise<string[]> {
  const prompt = input.systemPrompt?.trim();
  if (!prompt) return [];

  const connected = await listConnectedToolkits(input.userId);
  if (connected.length === 0) return [];

  const available = connected.map((t) => t.slug);

  try {
    const model = await getModelInstance(DERIVE_MODEL, input.userId);
    const { object } = await generateObject({
      model,
      experimental_telemetry: aiTelemetry("tool.composio.scope"),
      schema: z.object({
        toolkits: z.array(z.string()),
      }),
      system: `Given a project's purpose (system prompt) and a list of the user's connected tool TOOLKIT SLUGS, return the subset of slugs that are relevant to running this project's automations and dashboards. Only return slugs that appear in the provided list. If none are clearly relevant, return an empty array.

Connected toolkit slugs:\n${available.join(", ")}`,
      messages: [{ role: "user", content: prompt }],
    });
    const set = new Set(available);
    return object.toolkits.filter((slug) => set.has(slug));
  } catch (error) {
    logger.warn("Toolkit derivation failed:", error);
    return [];
  }
}

/**
 * Load the user's Composio tools SCOPED to the given toolkit slugs. Used for
 * project-context runs (widget population, project brain) only. An empty
 * `toolkits` list yields no tools (fail closed) — it never falls back to the
 * full set, which is reserved for the user's normal chat.
 */
export async function loadProjectComposioTools(
  userId: string,
  toolkits: string[] | null | undefined,
): Promise<Record<string, Tool>> {
  if (!toolkits || toolkits.length === 0) return {};
  const slugs = [...new Set(toolkits.map((t) => t.toLowerCase()))];
  try {
    // Fetch the toolkit actions directly. `loadComposioTools` uses a Tool
    // Router session whose `tools()` returns only meta/helper tools, so a
    // prefix filter over it comes back empty — `tools.get({ toolkits })`
    // returns the real GMAIL_*/TODOIST_* actions.
    const tools = (await composio.tools.get(userId, {
      toolkits: slugs,
    })) as unknown as Record<string, Tool>;
    return tools ?? {};
  } catch (error) {
    logger.warn(
      `Failed to load scoped tools for [${slugs.join(", ")}]:`,
      error instanceof Error ? error.message : error,
    );
    return {};
  }
}
