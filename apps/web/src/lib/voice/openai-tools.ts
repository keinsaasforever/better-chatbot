import type { ChatMention } from "app-types/chat";
import type { VercelAIMcpTool } from "app-types/mcp";
import { createMCPToolId } from "lib/ai/mcp/mcp-tool-id";
import { DEFAULT_VOICE_TOOLS } from "lib/ai/speech";
import {
  getVoiceAppToolDefinitions,
  type VoiceAppToolCapabilities,
  voiceAppToolToRealtimeFunction,
} from "./app-tool-definitions";
import {
  VoiceMcpToolReference,
  VoiceToolExecutionMap,
  VoiceToolStatus,
} from "./types";

export type OpenAIRealtimeFunctionTool = {
  name: string;
  type: "function";
  description?: string;
  parameters: Record<string, unknown>;
};

export type OpenAIRealtimeToolSetup = {
  tools: OpenAIRealtimeFunctionTool[];
  toolStatus: VoiceToolStatus;
  toolExecutionMap: VoiceToolExecutionMap;
};

function getStaticDescription(tool: VercelAIMcpTool): string | undefined {
  return typeof tool.description === "string" ? tool.description : undefined;
}

function normalizeObjectSchema(
  tool: VercelAIMcpTool,
  exposedName: string,
): Record<string, unknown> {
  const inputSchema = (tool.inputSchema as { jsonSchema?: unknown }).jsonSchema;
  const schema = inputSchema ?? {
    type: "object",
    properties: {},
    required: [],
  };

  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    throw new Error(`Invalid input schema for realtime tool "${exposedName}"`);
  }

  const normalized = { ...(schema as Record<string, unknown>) };
  if (normalized.type != null && normalized.type !== "object") {
    throw new Error(
      `Realtime tool "${exposedName}" must use an object input schema`,
    );
  }
  normalized.type = "object";
  normalized.properties =
    typeof normalized.properties === "object" &&
    normalized.properties !== null &&
    !Array.isArray(normalized.properties)
      ? normalized.properties
      : {};
  normalized.required = Array.isArray(normalized.required)
    ? normalized.required
    : [];

  try {
    JSON.stringify(normalized);
  } catch {
    throw new Error(
      `Input schema for realtime tool "${exposedName}" is not serializable`,
    );
  }

  return normalized;
}

export function vercelAIToolToOpenAITool(tool: VercelAIMcpTool, name: string) {
  return {
    name,
    type: "function" as const,
    description: getStaticDescription(tool),
    parameters: normalizeObjectSchema(tool, name),
  };
}

/**
 * What OpenAI accepts as a realtime function name.
 *
 * MCP names are built by `createMCPToolId`, which already normalizes them.
 * Composio's arrive raw from the vendor's router, and a rejected name does not
 * cost one tool: the session config is validated as a whole, so it fails the
 * connect and the user gets no voice chat at all.
 */
const REALTIME_FUNCTION_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * A Composio Tool Router tool as a realtime function tool.
 *
 * Separate from `vercelAIToolToOpenAITool` because the input schema arrives in
 * a different shape: MCP tools always carry `inputSchema.jsonSchema`, while a
 * Composio tool may carry either that or a raw JSON Schema object. Falling
 * through to an empty object schema — which is what the MCP path does when it
 * finds no `jsonSchema` — would silently strip every parameter and leave the
 * model calling a search tool with no query.
 */
function composioToolToRealtimeFunction(
  tool: unknown,
  name: string,
): OpenAIRealtimeFunctionTool | null {
  if (!REALTIME_FUNCTION_NAME_PATTERN.test(name)) return null;

  const candidate = tool as {
    description?: unknown;
    inputSchema?: { jsonSchema?: unknown } | Record<string, unknown>;
  };
  const raw =
    (candidate.inputSchema as { jsonSchema?: unknown } | undefined)
      ?.jsonSchema ?? candidate.inputSchema;

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const schema = { ...(raw as Record<string, unknown>) };
  if (schema.type != null && schema.type !== "object") return null;
  schema.type = "object";
  schema.properties =
    typeof schema.properties === "object" &&
    schema.properties !== null &&
    !Array.isArray(schema.properties)
      ? schema.properties
      : {};
  schema.required = Array.isArray(schema.required) ? schema.required : [];
  delete (schema as { $schema?: unknown }).$schema;

  try {
    JSON.stringify(schema);
  } catch {
    return null;
  }

  return {
    name,
    type: "function",
    description:
      typeof candidate.description === "string"
        ? candidate.description
        : undefined,
    parameters: schema,
  };
}

function mentionToReference(
  mention: Extract<ChatMention, { type: "mcpTool" | "mcpServer" }>,
): VoiceMcpToolReference {
  return {
    serverId: mention.serverId,
    serverName:
      mention.type === "mcpTool"
        ? (mention.serverName ?? mention.serverId)
        : mention.name,
    toolName: mention.type === "mcpTool" ? mention.name : "*",
    description: mention.description,
  };
}

function isReferenceAvailable(
  reference: VoiceMcpToolReference,
  available: VoiceMcpToolReference[],
): boolean {
  return available.some(
    (candidate) =>
      candidate.serverId === reference.serverId &&
      (reference.toolName === "*" || candidate.toolName === reference.toolName),
  );
}

export function buildOpenAIRealtimeToolSetup({
  mcpTools,
  requestedMentions = [],
  includeDefaultVoiceTools = true,
  includeAppTools = false,
  appToolCapabilities = { browserAutomation: false },
  composioTools = {},
}: {
  mcpTools: Record<string, VercelAIMcpTool>;
  /**
   * Composio Tool Router meta-tools, keyed by tool name. Four at most, so
   * unlike a per-action toolset these fit a realtime session's per-turn config.
   */
  composioTools?: Record<string, unknown>;
  requestedMentions?: ChatMention[];
  includeDefaultVoiceTools?: boolean;
  includeAppTools?: boolean;
  /**
   * Which capability-gated app tools this session gets. Defaults to none, so a
   * caller that forgets to resolve the org policy offers fewer tools rather
   * than more.
   */
  appToolCapabilities?: VoiceAppToolCapabilities;
}): OpenAIRealtimeToolSetup {
  const toolExecutionMap: VoiceToolExecutionMap = {};
  const available: VoiceMcpToolReference[] = [];
  const usedNames = new Set<string>();
  const appToolDefinitions = getVoiceAppToolDefinitions(appToolCapabilities);

  if (includeDefaultVoiceTools) {
    for (const tool of DEFAULT_VOICE_TOOLS) {
      usedNames.add(tool.name);
    }
  }

  // App-tool names are reserved before MCP mapping so a colliding MCP tool id
  // throws loudly at setup instead of mis-routing at execution time. Browser-
  // target tools get no execution-map entry — the hook handles them inline.
  if (includeAppTools) {
    for (const definition of appToolDefinitions) {
      usedNames.add(definition.name);
      if (definition.target === "server") {
        toolExecutionMap[definition.name] = {
          kind: "app",
          toolName: definition.name,
        };
      }
    }
  }

  const openAiTools = Object.values(mcpTools).map((tool) => {
    const exposedName = createMCPToolId(
      tool._mcpServerName,
      tool._originToolName,
    );
    if (usedNames.has(exposedName)) {
      throw new Error(`Duplicate realtime tool name "${exposedName}"`);
    }
    usedNames.add(exposedName);

    toolExecutionMap[exposedName] = {
      mcpServerId: tool._mcpServerId,
      mcpServerName: tool._mcpServerName,
      toolName: tool._originToolName,
    };
    available.push({
      serverId: tool._mcpServerId,
      serverName: tool._mcpServerName,
      toolName: tool._originToolName,
      exposedName,
      description: getStaticDescription(tool),
    });

    return vercelAIToolToOpenAITool(tool, exposedName);
  });

  const requested = requestedMentions
    .filter(
      (
        mention,
      ): mention is Extract<ChatMention, { type: "mcpTool" | "mcpServer" }> =>
        mention.type === "mcpTool" || mention.type === "mcpServer",
    )
    .map(mentionToReference);
  const unavailable = requested.filter(
    (reference) => !isReferenceAvailable(reference, available),
  );

  const tools: OpenAIRealtimeFunctionTool[] = [...openAiTools];
  if (includeDefaultVoiceTools) {
    tools.push(
      ...DEFAULT_VOICE_TOOLS.map((tool) => ({
        ...tool,
        type: "function" as const,
      })),
    );
  }
  if (includeAppTools) {
    tools.push(...appToolDefinitions.map(voiceAppToolToRealtimeFunction));
  }

  // Last, so they sit at the bottom of the tool list and never shadow a
  // first-party tool — the same ordering the chat route gives Composio. A name
  // that collides with one already taken is dropped rather than allowed to
  // mis-route at execution time.
  for (const [name, composioTool] of Object.entries(composioTools)) {
    if (usedNames.has(name)) continue;
    const converted = composioToolToRealtimeFunction(composioTool, name);
    if (!converted) continue;
    usedNames.add(name);
    toolExecutionMap[name] = { kind: "composio", toolName: name };
    tools.push(converted);
  }

  return {
    tools,
    toolStatus: { requested, available, unavailable },
    toolExecutionMap,
  };
}

export function buildOpenAIRealtimeTools({
  mcpTools,
  includeDefaultVoiceTools = true,
}: {
  mcpTools: Record<string, VercelAIMcpTool>;
  includeDefaultVoiceTools?: boolean;
}) {
  return buildOpenAIRealtimeToolSetup({
    mcpTools,
    includeDefaultVoiceTools,
  }).tools;
}

export function serializeRealtimeFunctionOutput(output: unknown): string {
  return JSON.stringify(output ?? null)
    .trim()
    .slice(0, 15000);
}

export const DEFAULT_BROWSER_VOICE_TOOL_NAMES = DEFAULT_VOICE_TOOLS.map(
  (tool) => tool.name,
);

export function isDefaultVoiceTool(toolName: string): boolean {
  return DEFAULT_BROWSER_VOICE_TOOL_NAMES.includes(toolName);
}
