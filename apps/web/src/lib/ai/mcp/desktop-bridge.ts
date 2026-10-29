"use client";

import { isDesktop } from "@keinsaas/mcp-core/is-desktop";
import type { MCPServerConfig, MCPToolInfo } from "@keinsaas/mcp-types";
import { requiresDeviceExecution } from "@keinsaas/mcp-router/execution-plane";

export function isDesktopClient(): boolean {
  return isDesktop && !!window.desktop?.mcp;
}

export function shouldUseDesktopMcpBridge(config: MCPServerConfig): boolean {
  return isDesktopClient() && requiresDeviceExecution(config);
}

export async function listMcpToolsViaDesktop(
  config: MCPServerConfig,
): Promise<MCPToolInfo[]> {
  if (!shouldUseDesktopMcpBridge(config)) {
    throw new Error("Desktop MCP bridge is not available for this config");
  }
  return window.desktop!.mcp.listTools(config) as Promise<MCPToolInfo[]>;
}

export async function callMcpToolViaDesktop(
  config: MCPServerConfig,
  toolName: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  if (!shouldUseDesktopMcpBridge(config)) {
    throw new Error("Desktop MCP bridge is not available for this config");
  }
  return window.desktop!.mcp.callTool({ config, toolName, params });
}

export async function logDesktopAuditEvent(event: unknown): Promise<void> {
  if (!window.desktop?.audit) return;
  await window.desktop.audit.log(event);
}
