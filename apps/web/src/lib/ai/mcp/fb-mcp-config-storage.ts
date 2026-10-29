import type { MCPServerConfig } from "app-types/mcp";
import { dirname } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import type {
  MCPClientsManager,
  MCPConfigStorage,
} from "./create-mcp-clients-manager";
import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";
import { createDebounce } from "lib/utils";
import equal from "lib/equal";
import defaultLogger from "logger";
import { MCP_CONFIG_PATH } from "lib/ai/mcp/config-path";
import { colorize } from "consola/utils";
import { McpServerTable } from "lib/db/pg/schema.pg";

const logger = defaultLogger.withDefaults({
  message: colorize("gray", `MCP File Config Storage: `),
});

/**
 * Creates a file-based implementation of MCPServerStorage
 */
export function createFileBasedMCPConfigsStorage(
  path?: string,
): MCPConfigStorage {
  const configPath = path || MCP_CONFIG_PATH;
  let watcher: FSWatcher | null = null;
  let manager: MCPClientsManager;
  const debounce = createDebounce();

  /**
   * Reads config from file
   */
  async function readConfigFile(): Promise<
    (typeof McpServerTable.$inferSelect)[]
  > {
    try {
      const configText = await readFile(configPath, { encoding: "utf-8" });
      const config = JSON.parse(configText ?? "{}") as {
        [name: string]: MCPServerConfig;
      };
      return toMcpServerArray(config);
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return [];
      } else if (err instanceof SyntaxError) {
        throw new Error(
          `Config file ${configPath} has invalid JSON: ${err.message}`,
        );
      } else {
        throw err;
      }
    }
  }

  /**
   * Writes config to file
   */
  async function writeConfigFile(
    config: Record<string, MCPServerConfig>,
  ): Promise<void> {
    const dir = dirname(configPath);
    await mkdir(dir, { recursive: true });
    await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  }

  async function checkAndRefreshClients() {
    try {
      logger.debug("Checking MCP clients Diff");
      const fileConfig = await readConfigFile();

      const fileConfigs = fileConfig.sort((a, b) => a.id.localeCompare(b.id));

      // Get current manager configs
      const managerConfigs = await manager
        .getClients()
        .then((clients) =>
          clients.map(({ client, id }) => ({
            id,
            name: client.getInfo().name,
            config: client.getInfo().config,
          })),
        )
        .then((configs) =>
          configs.sort((a, b) => a.name.localeCompare(b.name)),
        );

      let shouldRefresh = false;
      if (fileConfigs.length !== managerConfigs.length) {
        shouldRefresh = true;
      } else if (!equal(fileConfigs, managerConfigs)) {
        shouldRefresh = true;
      }

      if (shouldRefresh) {
        const refreshPromises = fileConfigs.map(
          async ({ id, name, config }) => {
            const managerConfig = await manager.getClient(id);
            if (!managerConfig) {
              logger.debug(`Adding MCP client ${id}`);
              return manager.addClient(id, name, config);
            }
            if (!equal(managerConfig.client.getInfo().config, config)) {
              logger.debug(`Refreshing MCP client ${id}`);
              return manager.refreshClient(id);
            }
          },
        );
        const deletePromises = managerConfigs
          .filter((c) => {
            const fileConfig = fileConfigs.find((c2) => c2.id === c.id);
            return !fileConfig;
          })
          .map((c) => {
            logger.debug(`Removing MCP client ${c.id}`);
            return manager.removeClient(c.id);
          });
        await Promise.allSettled([...refreshPromises, ...deletePromises]);
      }
    } catch (err) {
      logger.error("Error checking and refreshing clients:", err);
    }
  }

  /**
   * Initializes storage by reading existing config or creating empty file
   */
  async function init(_manager: MCPClientsManager): Promise<void> {
    manager = _manager;

    // Stop existing watcher if any
    if (watcher) {
      await watcher.close();
      watcher = null;
    }

    // Ensure config file exists
    try {
      await readConfigFile();
    } catch (err: any) {
      if (err.code === "ENOENT") {
        // Create empty config file if doesn't exist
        await writeConfigFile({});
      } else {
        throw err;
      }
    }

    // Setup file watcher
    watcher = chokidar.watch(configPath, {
      persistent: true,
      awaitWriteFinish: true,
      ignoreInitial: true,
    });

    watcher.on("change", () => debounce(checkAndRefreshClients, 1000));
  }

  return {
    init,
    async loadAll() {
      return await readConfigFile();
    },
    // Saves a configuration with the given name
    async save(server) {
      const currentConfig = await readConfigFile().then(toMcpServerRecord);
      currentConfig[server.name] = server.config;
      await writeConfigFile(currentConfig);
      return fillMcpServerTable(server);
    },
    // Deletes a configuration by name
    async delete(id) {
      const currentConfig = await readConfigFile();
      const newConfig = currentConfig.filter((s) => s.id !== id);
      await writeConfigFile(toMcpServerRecord(newConfig));
    },

    // Checks if a configuration exists
    async has(id) {
      const currentConfig = await readConfigFile();
      return currentConfig.some((s) => s.id === id);
    },
    async get(id) {
      const currentConfig = await readConfigFile();
      return currentConfig.find((s) => s.id === id) ?? null;
    },
  };
}

function fillMcpServerTable(
  server: typeof McpServerTable.$inferInsert,
): typeof McpServerTable.$inferSelect {
  return {
    ...server,
    id: server.name,
    userId: server.userId,
    organizationId: server.organizationId ?? null,
    visibility: server.visibility || "private",
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function toMcpServerArray(
  config: Record<string, MCPServerConfig>,
): (typeof McpServerTable.$inferSelect)[] {
  return Object.entries(config).map(([name, config]) =>
    fillMcpServerTable({
      id: name,
      name,
      config,
      userId: "file-based-user",
      visibility: "private",
    }),
  );
}

function toMcpServerRecord(
  servers: (typeof McpServerTable.$inferSelect)[],
): Record<string, MCPServerConfig> {
  return servers.reduce(
    (acc, server) => {
      acc[server.name] = server.config;
      return acc;
    },
    {} as Record<string, MCPServerConfig>,
  );
}
