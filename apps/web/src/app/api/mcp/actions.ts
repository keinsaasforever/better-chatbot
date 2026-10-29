"use server";
import {
  mcpClientsManager,
  getMCPClientsManager,
} from "lib/ai/mcp/mcp-manager";

import { mcpOAuthRepository, mcpRepository } from "lib/db/repository";
import { canManageMCPServer, getCurrentUser } from "lib/auth/permissions";
import globalLogger from "logger";
import { colorize } from "consola/utils";

const logger = globalLogger.withDefaults({
  message: colorize("yellow", "[MCP Actions - Deprecated]: "),
});

async function assertCanManageMcpServer(id: string) {
  const mcpServer = await mcpRepository.selectById(id);
  if (!mcpServer) {
    throw new Error("MCP server not found");
  }
  const canManage = await canManageMCPServer(mcpServer.userId);
  if (!canManage) {
    throw new Error("You don't have permission to access this MCP connection");
  }
}

/**
 * @deprecated Use /api/mcp/rpc/list-tools endpoint instead
 */
export async function selectMcpClientAction(id: string) {
  logger.warn(
    "selectMcpClientAction is deprecated. Use /api/mcp/rpc/list-tools instead.",
  );
  await assertCanManageMcpServer(id);
  const client = await mcpClientsManager.getClient(id);
  if (!client) {
    throw new Error("Client not found");
  }
  return {
    ...client.client.getInfo(),
    id,
  };
}

export async function authorizeMcpClientAction(id: string) {
  const currentUser = await getCurrentUser();
  if (!currentUser?.id) throw new Error("Unauthorized");
  await assertCanManageMcpServer(id);

  // Clear any stale tokens before refreshing so a dead grant (revoked, or a
  // registration stranded by a domain move) can't be silently reused — this
  // deterministically pushes connect into a fresh OAuth flow. Single choke
  // point behind both the card and the tool-selector Authorize buttons.
  const session = await mcpOAuthRepository.getAuthenticatedSession(id);
  if (session?.state) {
    await mcpOAuthRepository.clearTokens(session.state);
  }

  const userManager = getMCPClientsManager(currentUser.id);
  await userManager.refreshClient(id);
  const client = await userManager.getClient(id);
  if (client?.client.status != "authorizing") {
    throw new Error("Not Authorizing");
  }
  return client.client.getAuthorizationUrl()?.toString();
}

export async function checkTokenMcpClientAction(id: string) {
  await assertCanManageMcpServer(id);
  const session = await mcpOAuthRepository.getAuthenticatedSession(id);

  // wait for mcp server to connect
  const currentUser = await getCurrentUser();
  if (currentUser?.id) {
    await getMCPClientsManager(currentUser.id)
      .getClient(id)
      .catch(() => null);
  }

  return !!session?.tokens;
}

/**
 * @deprecated Use /api/mcp/rpc/tool-call endpoint instead
 * Example:
 * ```ts
 * await fetch('/api/mcp/rpc/tool-call', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({ mcpServerId: id, toolName, params: input }),
 * });
 * ```
 */
export async function callMcpToolAction(
  id: string,
  toolName: string,
  input: unknown,
) {
  logger.warn(
    "callMcpToolAction is deprecated. Use /api/mcp/rpc/tool-call endpoint instead.",
  );
  await assertCanManageMcpServer(id);
  return mcpClientsManager.toolCall(id, toolName, input);
}
