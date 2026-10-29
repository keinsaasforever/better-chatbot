import type {
  MCPClientsManager,
  MCPConfigStorage,
} from "./create-mcp-clients-manager";
import type { McpServerInsert, McpServerSelect } from "app-types/mcp";

/**
 * In-memory implementation of MCPConfigStorage.
 * This storage keeps all configurations in memory and does not persist them.
 * Useful for testing or temporary configurations.
 */
export class MemoryMCPConfigStorage implements MCPConfigStorage {
  private configs = new Map<string, McpServerSelect>();
  private idCounter = 0;

  async init(_manager: MCPClientsManager): Promise<void> {
    // No initialization needed for memory storage
  }

  async loadAll(): Promise<McpServerSelect[]> {
    return Array.from(this.configs.values());
  }

  async save(server: McpServerInsert): Promise<McpServerSelect> {
    const id = server.id || `memory-${++this.idCounter}`;
    const savedServer: McpServerSelect = {
      id,
      name: server.name,
      config: server.config,
      userId: server.userId,
      visibility: server.visibility || "private",
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.configs.set(id, savedServer);
    return savedServer;
  }

  async delete(id: string): Promise<void> {
    this.configs.delete(id);
  }

  async has(id: string): Promise<boolean> {
    return this.configs.has(id);
  }

  async get(id: string): Promise<McpServerSelect | null> {
    return this.configs.get(id) || null;
  }

  /**
   * Clears all stored configurations.
   * Useful for testing.
   */
  clear(): void {
    this.configs.clear();
    this.idCounter = 0;
  }

  /**
   * Gets the current size of stored configurations.
   * Useful for testing.
   */
  size(): number {
    return this.configs.size;
  }
}

/**
 * Creates a new memory-based MCP configuration storage.
 */
export function createMemoryMCPConfigStorage(): MCPConfigStorage {
  return new MemoryMCPConfigStorage();
}
