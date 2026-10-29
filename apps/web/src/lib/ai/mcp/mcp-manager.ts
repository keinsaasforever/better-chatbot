import { createDbBasedMCPConfigsStorage } from "./db-mcp-config-storage";
import { createFileBasedMCPConfigsStorage } from "./fb-mcp-config-storage";
import {
  createMCPClientsManager,
  type MCPClientsManager,
} from "./create-mcp-clients-manager";
import { FILE_BASED_MCP_CONFIG } from "lib/const";

declare global {
  // eslint-disable-next-line no-var
  var __mcpClientsManagerMap__: Map<string, MCPClientsManager>;
  // eslint-disable-next-line no-var
  var __globalMcpClientsManager__: MCPClientsManager;
}

// Initialize global map for user-scoped managers
if (!globalThis.__mcpClientsManagerMap__) {
  globalThis.__mcpClientsManagerMap__ = new Map();
}

// Legacy global manager for backward compatibility (loads no servers for security)
if (!globalThis.__globalMcpClientsManager__) {
  const storage = FILE_BASED_MCP_CONFIG
    ? createFileBasedMCPConfigsStorage()
    : createDbBasedMCPConfigsStorage(); // No userId = empty for security
  globalThis.__globalMcpClientsManager__ = createMCPClientsManager(storage);
}

/**
 * Get or create a user-scoped MCP clients manager
 * Each user gets their own manager instance with only their accessible servers
 */
export const getMCPClientsManager = (userId: string): MCPClientsManager => {
  if (!globalThis.__mcpClientsManagerMap__.has(userId)) {
    const storage = FILE_BASED_MCP_CONFIG
      ? createFileBasedMCPConfigsStorage()
      : createDbBasedMCPConfigsStorage(userId);

    const manager = createMCPClientsManager(storage);
    globalThis.__mcpClientsManagerMap__.set(userId, manager);
  }

  return globalThis.__mcpClientsManagerMap__.get(userId)!;
};

/**
 * Initialize MCP manager for a specific user
 */
export const initMCPManager = async (userId?: string) => {
  if (userId) {
    return getMCPClientsManager(userId).init();
  }
  return globalThis.__globalMcpClientsManager__.init();
};

/**
 * @deprecated Use getMCPClientsManager(userId) instead for security
 * This global manager loads no servers for security reasons
 */
export const mcpClientsManager = globalThis.__globalMcpClientsManager__;
