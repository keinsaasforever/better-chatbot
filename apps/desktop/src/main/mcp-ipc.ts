import { ipcMain } from "electron";
import type { MCPServerConfig } from "@keinsaas/mcp-types";
import { parseAuditEvent, writeAuditEvent } from "./audit-sink.js";
import { callDesktopMcpTool, listDesktopMcpTools } from "./mcp-spawner.js";

type McpListToolsPayload = {
  config: MCPServerConfig;
};

type McpToolCallPayload = {
  config: MCPServerConfig;
  toolName: string;
  params?: Record<string, unknown>;
};

export function registerMcpIpcHandlers(): void {
  ipcMain.handle(
    "mcp:list-tools",
    async (_event, payload: McpListToolsPayload) => {
      return listDesktopMcpTools(payload.config);
    },
  );

  ipcMain.handle(
    "mcp:tool-call",
    async (_event, payload: McpToolCallPayload) => {
      return callDesktopMcpTool(
        payload.config,
        payload.toolName,
        payload.params ?? {},
      );
    },
  );

  ipcMain.handle("audit:log", async (_event, payload: unknown) => {
    const event = parseAuditEvent(payload);
    writeAuditEvent(event);
    return { ok: true };
  });
}
