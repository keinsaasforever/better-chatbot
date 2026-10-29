import { createEphemeralMCPClient } from "lib/ai/mcp/ephemeral-client";
import { extractMCPToolId } from "lib/ai/mcp/mcp-tool-id";
import { mcpRepository } from "lib/db/repository";
import { voiceToolDuration } from "lib/observability/instruments";
import {
  getVoiceAppToolDefinition,
  isVoiceAppToolName,
} from "./app-tool-definitions";
import { isDefaultVoiceTool } from "./openai-tools";
import {
  VoiceActor,
  VoiceToolExecutionInput,
  VoiceToolExecutionResult,
} from "./types";

function errorResult(
  toolName: string,
  message: string,
  code?: string,
  callId?: string,
): VoiceToolExecutionResult {
  return {
    ok: false,
    toolName,
    callId,
    output: null,
    error: { message, code },
  };
}

async function executeServerSupportedDefaultVoiceTool(
  toolName: string,
  args: unknown,
  actor: VoiceActor,
  callId?: string,
): Promise<VoiceToolExecutionResult> {
  switch (toolName) {
    case "changeBrowserTheme":
      if (actor.source === "m5stack") {
        return {
          ok: true,
          toolName,
          callId,
          output: { skipped: true, reason: "browser_only" },
        };
      }
      return {
        ok: true,
        toolName,
        callId,
        output: { theme: (args as { theme?: string })?.theme ?? null },
      };
    case "endConversation":
      return {
        ok: true,
        toolName,
        callId,
        output: { ended: true },
      };
    default:
      return errorResult(
        toolName,
        "Unknown default voice tool",
        "unknown_tool",
        callId,
      );
  }
}

function normalizeToolError(
  toolName: string,
  error: unknown,
  callId?: string,
): VoiceToolExecutionResult {
  const message =
    error instanceof Error ? error.message : "Tool execution failed";
  return errorResult(toolName, message, "tool_execution_failed", callId);
}

/**
 * Run an app tool from the registry for the session's actor.
 *
 * Browser-target tools (activateAgent, browseWeb, checkBrowserRun) are handled
 * by the voice hook and never run here; a registry tool hidden from voice
 * (`voice: false`) was never offered to the session, so a call for it is a
 * hallucination and is refused rather than executed.
 */
async function executeAppTool(
  input: VoiceToolExecutionInput,
  args: unknown,
): Promise<VoiceToolExecutionResult> {
  const definition = getVoiceAppToolDefinition(input.toolName);
  if (!definition || definition.target !== "server") {
    return errorResult(
      input.toolName,
      "This tool is not available in a voice session",
      "unknown_tool",
      input.callId,
    );
  }

  const { runTool } = await import("lib/navigator-tools/registry");
  const result = await runTool(
    {
      userId: input.actor.userId,
      organizationId: input.actor.organizationId ?? null,
      source: "voice",
    },
    input.toolName,
    args,
  );
  return result.ok
    ? {
        ok: true,
        toolName: input.toolName,
        callId: input.callId,
        output: result.output,
      }
    : errorResult(
        input.toolName,
        result.error.message,
        result.error.code,
        input.callId,
      );
}

function voiceToolKind(input: VoiceToolExecutionInput): string {
  if (input.kind === "composio") return "composio";
  if (isDefaultVoiceTool(input.toolName)) return "default";
  if (isVoiceAppToolName(input.toolName)) return "app";
  return "mcp";
}

/**
 * Execute one voice tool call and record `voice.tool.duration`.
 *
 * The tool name is only a metric dimension for app and default tools, whose
 * names are code constants; MCP and Composio names are user-defined.
 */
export async function executeVoiceTool(
  input: VoiceToolExecutionInput,
): Promise<VoiceToolExecutionResult> {
  const startedAt = performance.now();
  const kind = voiceToolKind(input);
  let ok = false;
  try {
    const result = await executeVoiceToolUntimed(input);
    ok = result.ok;
    return result;
  } finally {
    voiceToolDuration.record(performance.now() - startedAt, {
      kind,
      tool: kind === "app" || kind === "default" ? input.toolName : kind,
      outcome: ok ? "ok" : "error",
    });
  }
}

async function executeVoiceToolUntimed(
  input: VoiceToolExecutionInput,
): Promise<VoiceToolExecutionResult> {
  if (Boolean(input.mcpServerId) !== Boolean(input.mcpToolName)) {
    return errorResult(
      input.toolName,
      "MCP server and tool must be provided together",
      "invalid_arguments",
      input.callId,
    );
  }

  const args =
    input.arguments ??
    (input.argumentsText ? JSON.parse(input.argumentsText) : {});

  // Composio tools are dispatched on the caller's declared `kind` rather than
  // on their name. They are neither app-allowlisted nor shaped like an MCP tool
  // id, so name-sniffing would fall through to the MCP path and fail with a
  // misleading "MCP server not found".
  if (input.kind === "composio") {
    const { executeComposioVoiceTool } = await import(
      "./execute-composio-tool"
    );
    return executeComposioVoiceTool({
      toolName: input.toolName,
      args,
      actor: input.actor,
      callId: input.callId,
    });
  }

  if (isDefaultVoiceTool(input.toolName)) {
    return executeServerSupportedDefaultVoiceTool(
      input.toolName,
      args,
      input.actor,
      input.callId,
    );
  }

  // App-control tools dispatch by allowlisted name before any MCP resolution,
  // straight into the Navigator tool registry: in-process, so a spoken tool
  // call pays no HTTP hop through the MCP route. Dynamic import keeps the
  // device transcript path free of the registry's dependencies.
  if (isVoiceAppToolName(input.toolName)) {
    return executeAppTool(input, args);
  }

  const legacyTarget =
    input.mcpServerId && input.mcpToolName
      ? null
      : extractMCPToolId(input.toolName);
  const mcpServerId = input.mcpServerId;
  const toolName = input.mcpToolName ?? legacyTarget?.toolName;
  const server = mcpServerId
    ? await mcpRepository.selectById(mcpServerId)
    : await mcpRepository.selectByServerName(legacyTarget?.serverName ?? "");
  if (!server) {
    return errorResult(
      input.toolName,
      "MCP server not found",
      "not_found",
      input.callId,
    );
  }

  if (!server.enabled || !toolName) {
    return errorResult(
      input.toolName,
      "MCP server or tool is not available",
      "unavailable",
      input.callId,
    );
  }

  const hasAccess = await mcpRepository.checkAccess(
    server.id,
    input.actor.userId,
    false,
    input.actor.organizationId,
  );
  if (!hasAccess) {
    return errorResult(input.toolName, "Forbidden", "forbidden", input.callId);
  }

  const client = await createEphemeralMCPClient(server.id, input.actor.userId, {
    organizationId: input.actor.organizationId,
  });
  if (!client) {
    return errorResult(
      input.toolName,
      "MCP server not available",
      "unavailable",
      input.callId,
    );
  }

  try {
    const output = await client.callTool(toolName, args);
    return {
      ok: true,
      toolName: input.toolName,
      callId: input.callId,
      output,
    };
  } catch (error) {
    return normalizeToolError(input.toolName, error, input.callId);
  } finally {
    await client.disconnect();
  }
}
