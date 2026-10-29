import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import type { MCPServerConfig, MCPToolInfo } from "@keinsaas/mcp-types";

import { isMaybeRemoteConfig, isMaybeStdioConfig } from "@keinsaas/mcp-types";

import {
  assertDesktopMcpToolAllowed,
  filterAllowedDesktopMcpTools,
} from "@keinsaas/mcp-core/mcp-tool-policy";

import { hashPayload } from "./audit-sink.js";

import {
  buildSseTransport,
  buildStdioTransport,
  buildStreamableHttpTransport,
  MCP_DEFAULT_CONNECT_TIMEOUT_MS,
  withTimeout,
} from "@keinsaas/mcp-router";

import { writeAuditEvent } from "./audit-sink.js";
import { recordDesktopError } from "./otel.js";

const CONNECT_TIMEOUT_MS = MCP_DEFAULT_CONNECT_TIMEOUT_MS;

async function connectClient(
  client: Client,
  config: MCPServerConfig,
): Promise<void> {
  if (isMaybeStdioConfig(config)) {
    const transport = buildStdioTransport(config, { remoteOnly: false });

    await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS);

    return;
  }

  if (isMaybeRemoteConfig(config)) {
    try {
      const transport = buildStreamableHttpTransport(config);

      await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS);

      return;
    } catch {
      const transport = buildSseTransport(config);

      await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS);

      return;
    }
  }

  throw new Error("Invalid MCP server config");
}

async function withConnectedClient<T>(
  config: MCPServerConfig,

  run: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({
    name: "keinsaas-navigator-desktop-mcp",

    version: "0.1.0",
  });

  try {
    await connectClient(client, config);

    return await run(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function listDesktopMcpTools(
  config: MCPServerConfig,
): Promise<MCPToolInfo[]> {
  return withConnectedClient(config, async (client) => {
    const result = await client.listTools();

    return filterAllowedDesktopMcpTools(result.tools).map(
      (tool) =>
        ({
          name: tool.name,

          description: tool.description,

          inputSchema: tool.inputSchema,
        }) as MCPToolInfo,
    );
  });
}

export async function callDesktopMcpTool(
  config: MCPServerConfig,

  toolName: string,

  params: Record<string, unknown> = {},
): Promise<unknown> {
  assertDesktopMcpToolAllowed(toolName);

  const argsHash = await hashPayload(params);

  try {
    const result = await withConnectedClient(config, async (client) =>
      client.callTool({ name: toolName, arguments: params }),
    );

    const resultHash = await hashPayload(result);

    writeAuditEvent({
      action: "mcp.tool.call",

      resourceType: "mcp_tool",

      toolName,

      argsHash,

      resultHash,

      outcome: "success",
    });

    return result;
  } catch (error) {
    writeAuditEvent({
      action: "mcp.tool.call",

      resourceType: "mcp_tool",

      toolName,

      argsHash,

      outcome: "failure",

      metadata: {
        error: error instanceof Error ? error.message : String(error),
      },
    });

    // The audit sink is local-only; this is what makes a local stdio MCP
    // failure visible to us at all.
    recordDesktopError("mcp.tool.call", error, { "mcp.tool.name": toolName });

    throw error;
  }
}
