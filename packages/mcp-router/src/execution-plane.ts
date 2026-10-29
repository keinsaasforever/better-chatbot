import type { MCPServerConfig } from "@keinsaas/mcp-types";
import { isMaybeStdioConfig } from "@keinsaas/mcp-types";

export const MCP_DEVICE_EXECUTION_REQUIRED = "MCP_DEVICE_EXECUTION_REQUIRED";

export class McpDeviceExecutionRequiredError extends Error {
  readonly code = MCP_DEVICE_EXECUTION_REQUIRED;

  constructor(message = "This MCP server requires device-side execution") {
    super(message);
    this.name = "McpDeviceExecutionRequiredError";
  }
}

/** Stdio MCP must run on the user's machine (desktop), not on Vercel/serverless. */
export function requiresDeviceExecution(config: MCPServerConfig): boolean {
  return isMaybeStdioConfig(config);
}

/** Whether the server-side runtime may spawn/connect this MCP config. */
export function canExecuteMcpOnServer(
  config: MCPServerConfig,
  remoteOnly: boolean,
): boolean {
  if (!requiresDeviceExecution(config)) return true;
  return !remoteOnly;
}

export function assertServerCanExecuteMcpConfig(
  config: MCPServerConfig,
  remoteOnly: boolean,
): void {
  if (!canExecuteMcpOnServer(config, remoteOnly)) {
    throw new McpDeviceExecutionRequiredError(
      "Stdio MCP servers cannot run on the cloud runtime. Use the desktop app for local execution.",
    );
  }
}
