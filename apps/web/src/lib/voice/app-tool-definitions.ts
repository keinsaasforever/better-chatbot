import { z } from "zod";
import {
  isNavigatorToolName,
  listNavigatorToolSpecs,
} from "lib/navigator-tools/definitions";
import type { OpenAIRealtimeFunctionTool } from "./openai-tools";

/**
 * App-control tools for the browser realtime voice session. Definitions are
 * client-safe (zod only) because the voice hook imports them to route tool
 * calls. Server tools are the Navigator tool registry
 * (`lib/navigator-tools`), executed in-process by `execute-voice-tool.ts`.
 *
 * - `target: "server"` tools run via POST /api/voice/tool.
 * - `target: "browser"` tools are handled inline by the voice hook
 *   (activateAgent must mutate client session state to reconnect).
 *
 * Keep schemas minimal and descriptions at 200 characters or less: every
 * property is re-billed with the session config on each realtime turn. The
 * longer how-to for each tool lives in the app-control prompt.
 */
export type VoiceAppToolTarget = "server" | "browser";

export type VoiceAppToolDefinition = {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  target: VoiceAppToolTarget;
  /** False for tools that mutate app state; the prompt requires spoken confirmation for those. */
  readOnly: boolean;
  /**
   * Offered only when this workspace has browser automation switched on.
   *
   * Realtime tools are frozen at connect time, so this is decided once when the
   * session is built rather than per call — and a tool that is never offered
   * cannot be hallucinated into a call that would only 403.
   */
  requiresBrowserAutomation?: boolean;
};

/**
 * The tools the voice hook handles in the browser. Everything else the voice
 * session can do comes from the Navigator tool registry (`registryVoiceTools`).
 */
export const BROWSER_VOICE_APP_TOOL_DEFINITIONS: VoiceAppToolDefinition[] = [
  {
    name: "activateAgent",
    description:
      "Hand the WHOLE session to an agent: the connection restarts as that agent and this conversation is lost. Only on an explicit request to switch; for an answer use run_agent.",
    schema: z.object({
      agent: z
        .string()
        .min(1)
        .max(200)
        .describe("The agent's name or id, as the user referred to it."),
    }),
    target: "browser",
    readOnly: false,
  },
  {
    name: "browseWeb",
    description:
      "Open a real browser for a task on a website behind a login or a form that search cannot reach. Returns once the browser is open; then call checkBrowserRun.",
    schema: z.object({
      task: z
        .string()
        .min(1)
        .max(2000)
        .describe(
          "What to do in the browser, in plain language. Include the starting URL and what a successful result looks like.",
        ),
    }),
    target: "browser",
    readOnly: false,
    requiresBrowserAutomation: true,
  },
  {
    name: "checkBrowserRun",
    description:
      "Wait for a browseWeb run and return its result. If it is still going, say what it is doing and call it again.",
    schema: z.object({
      sessionId: z.string().min(1).max(128),
    }),
    target: "browser",
    readOnly: true,
    requiresBrowserAutomation: true,
  },
];

/**
 * The Navigator registry tools the realtime session is offered, as voice app
 * tools. All run on the server via POST /api/voice/tool, which calls the
 * registry in-process (no HTTP loopback through the MCP route).
 */
export function registryVoiceTools(): VoiceAppToolDefinition[] {
  return listNavigatorToolSpecs({ voice: true }).map((definition) => ({
    name: definition.name,
    description: definition.description,
    schema: definition.input,
    target: "server",
    readOnly: definition.readOnly,
  }));
}

export const VOICE_APP_TOOL_DEFINITIONS: VoiceAppToolDefinition[] = [
  ...registryVoiceTools(),
  ...BROWSER_VOICE_APP_TOOL_DEFINITIONS,
];

const definitionsByName = new Map(
  VOICE_APP_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]),
);

export const VOICE_APP_TOOL_NAMES = VOICE_APP_TOOL_DEFINITIONS.map(
  (definition) => definition.name,
);

export function getVoiceAppToolDefinition(
  name: string,
): VoiceAppToolDefinition | undefined {
  return definitionsByName.get(name);
}

/**
 * Whether a name belongs to the app (not to MCP or Composio).
 *
 * True for registry tools that are hidden from voice too (`voice: false`), so a
 * hallucinated call for one is recognised and refused by the executor instead
 * of falling through to the MCP path as an unknown server.
 */
export function isVoiceAppToolName(name: string): boolean {
  return definitionsByName.has(name) || isNavigatorToolName(name);
}

export function isBrowserVoiceAppTool(name: string): boolean {
  return definitionsByName.get(name)?.target === "browser";
}

/** Capabilities that decide which app tools a session is offered. */
export type VoiceAppToolCapabilities = {
  browserAutomation: boolean;
};

/**
 * The app tools this session may use.
 *
 * Name lookups (`isVoiceAppToolName`, `getVoiceAppToolDefinition`) still see
 * the full list on purpose: a call for a tool that was never offered should be
 * recognised and refused clearly, not treated as an unknown MCP tool.
 */
export function getVoiceAppToolDefinitions(
  capabilities: VoiceAppToolCapabilities,
): VoiceAppToolDefinition[] {
  return VOICE_APP_TOOL_DEFINITIONS.filter(
    (definition) =>
      !definition.requiresBrowserAutomation || capabilities.browserAutomation,
  );
}

export function voiceAppToolToRealtimeFunction(
  definition: VoiceAppToolDefinition,
): OpenAIRealtimeFunctionTool {
  const jsonSchema = z.toJSONSchema(definition.schema) as Record<
    string,
    unknown
  >;
  delete jsonSchema.$schema;

  if (jsonSchema.type !== "object") {
    throw new Error(
      `Voice app tool "${definition.name}" must use an object input schema`,
    );
  }
  jsonSchema.properties =
    typeof jsonSchema.properties === "object" &&
    jsonSchema.properties !== null &&
    !Array.isArray(jsonSchema.properties)
      ? jsonSchema.properties
      : {};
  jsonSchema.required = Array.isArray(jsonSchema.required)
    ? jsonSchema.required
    : [];

  return {
    name: definition.name,
    type: "function",
    description: definition.description,
    parameters: jsonSchema,
  };
}
