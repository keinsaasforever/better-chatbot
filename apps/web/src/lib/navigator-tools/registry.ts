import "server-only";
import { navigatorToolDuration } from "lib/observability/instruments";
import globalLogger from "logger";
import { NAVIGATOR_TOOL_SPECS, isVoiceVisibleSpec } from "./definitions";
import { AGENT_TOOLS } from "./tools/agents";
import { CHAT_TOOLS } from "./tools/chat";
import { COCKPIT_TOOLS } from "./tools/cockpit";
import { PROJECT_TOOLS } from "./tools/projects";
import { SCHEDULED_TOOLS } from "./tools/scheduled";
import { SKILL_TOOLS } from "./tools/skills";
import { WORKFLOW_TOOLS } from "./tools/workflows";
import {
  type NavigatorTool,
  NavigatorToolError,
  type ToolActor,
  type ToolResult,
} from "./types";

const logger = globalLogger.withDefaults({ message: "Navigator Tools: " });

/**
 * Every Navigator tool, in catalog order.
 *
 * The catalog (`definitions.ts`) is the source of truth for names and
 * schemas; this only attaches each spec's `run`. A spec without a runner, or a
 * runner without a spec, is a programming error and fails at import time, so
 * a tool can never be advertised that nothing executes.
 */
export const NAVIGATOR_TOOLS: NavigatorTool[] = (() => {
  const runners = new Map<string, NavigatorTool>();
  for (const tool of [
    ...AGENT_TOOLS,
    ...CHAT_TOOLS,
    ...PROJECT_TOOLS,
    ...WORKFLOW_TOOLS,
    ...SCHEDULED_TOOLS,
    ...SKILL_TOOLS,
    ...COCKPIT_TOOLS,
  ] as NavigatorTool[]) {
    if (runners.has(tool.name)) {
      throw new Error(`Duplicate Navigator tool "${tool.name}"`);
    }
    runners.set(tool.name, tool);
  }
  const tools = NAVIGATOR_TOOL_SPECS.map((definition) => {
    const tool = runners.get(definition.name);
    if (!tool)
      throw new Error(`Navigator tool "${definition.name}" has no run`);
    runners.delete(definition.name);
    return tool;
  });
  if (runners.size > 0) {
    throw new Error(
      `Navigator tools without a catalog entry: ${[...runners.keys()].join(", ")}`,
    );
  }
  return tools;
})();

const toolsByName = new Map(NAVIGATOR_TOOLS.map((tool) => [tool.name, tool]));

export function getTool(name: string): NavigatorTool | undefined {
  return toolsByName.get(name);
}

/** All tools, or only the ones the realtime voice session is (not) offered. */
export function listTools(options: { voice?: boolean } = {}): NavigatorTool[] {
  if (options.voice === undefined) return NAVIGATOR_TOOLS;
  return NAVIGATOR_TOOLS.filter(
    (tool) => isVoiceVisibleSpec(tool) === options.voice,
  );
}

/** Round-trip through JSON so every caller gets the same plain shape (Dates → ISO). */
function toPlain(output: unknown): unknown {
  if (output === undefined) return null;
  return JSON.parse(JSON.stringify(output));
}

/**
 * Run a tool for an authenticated actor.
 *
 * Parse → run → serialize. Never throws: an unknown tool, invalid arguments, an
 * expected domain failure (`NavigatorToolError`) and an unexpected exception
 * all come back as `{ ok: false, error }`. Only the first three carry their own
 * message; an unexpected exception is logged here and answered generically, so
 * a stack trace or a database error never reaches an MCP client or a speaker.
 */
export async function runTool(
  actor: ToolActor,
  name: string,
  rawArgs: unknown,
): Promise<ToolResult> {
  const tool = toolsByName.get(name);
  if (!tool) {
    return {
      ok: false,
      error: { code: "unknown_tool", message: `Unknown tool "${name}"` },
    };
  }

  const parsed = tool.input.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: {
        code: "invalid_arguments",
        message: issue
          ? `${issue.path.join(".") || "arguments"}: ${issue.message}`
          : "Invalid arguments",
      },
    };
  }

  const startedAt = performance.now();
  let outcome: "ok" | "expected_error" | "error" = "ok";
  try {
    const output = await tool.run(actor, parsed.data);
    return { ok: true, output: toPlain(output) };
  } catch (error) {
    if (error instanceof NavigatorToolError) {
      outcome = "expected_error";
      return { ok: false, error: { code: error.code, message: error.message } };
    }
    outcome = "error";
    logger.error(`${name} failed (${actor.source})`, error);
    return {
      ok: false,
      error: {
        code: "tool_execution_failed",
        message: "The tool could not be completed. Please try again.",
      },
    };
  } finally {
    navigatorToolDuration.record(performance.now() - startedAt, {
      tool: name,
      source: actor.source,
      outcome,
    });
  }
}
