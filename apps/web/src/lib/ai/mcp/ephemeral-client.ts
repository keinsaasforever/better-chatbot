import {
  MCP_DEFAULT_CALL_TIMEOUT_MS,
  MCP_DEFAULT_CONNECT_TIMEOUT_MS,
  MCP_INTROSPECT_TIMEOUT,
  McpDeviceExecutionRequiredError,
  OAuthAuthorizationRequiredError,
  assertServerCanExecuteMcpConfig,
  buildSseTransport,
  buildStdioTransport,
  buildStreamableHttpTransport,
  retryMcpSessionOnce,
  shouldFallbackToSse,
  withTimeout,
} from "@keinsaas/mcp-router";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { type MCPServerConfig, type MCPToolInfo } from "app-types/mcp";
import { colorize } from "consola/utils";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import {
  BASE_URL,
  IS_MCP_SERVER_REMOTE_ONLY,
  MCP_OAUTH_SCOPE,
} from "lib/const";
import { pgDb } from "lib/db/pg/db.pg";
import { McpOAuthSessionTable, McpServerTable } from "lib/db/pg/schema.pg";
import globalLogger from "logger";
import { isMaybeRemoteConfig, isMaybeStdioConfig } from "./is-mcp-config";
import { isMcpServerInScope } from "./mcp-server-scope";
import { PgOAuthClientProvider } from "./pg-oauth-provider";

export { MCP_INTROSPECT_TIMEOUT, McpDeviceExecutionRequiredError };

const logger = globalLogger.withDefaults({
  message: colorize("cyan", "[Ephemeral MCP Client]: "),
});

const CONNECT_TIMEOUT = MCP_DEFAULT_CONNECT_TIMEOUT_MS;
const CALL_TIMEOUT = MCP_DEFAULT_CALL_TIMEOUT_MS;

/**
 * Ephemeral MCP Client - Created per request, disposed after use
 * No memory state, all config loaded from DB
 */
export class EphemeralMCPClient {
  private client: Client;
  private connected = false;
  public toolInfo: MCPToolInfo[] = [];
  private oauthProvider?: PgOAuthClientProvider;

  constructor(
    private serverId: string,
    private serverName: string,
    private config: MCPServerConfig,
    private oauthTokens?: any,
  ) {
    this.client = this.createClient();
  }

  private createClient(): Client {
    return new Client({
      name: `keinsaas-navigator-ephemeral-${this.serverName}`,
      version: "1.0.0",
    });
  }

  private async resetClient(): Promise<void> {
    await this.client.close().catch((error) => {
      logger.warn(`Error closing ${this.serverName} client:`, error);
    });
    this.client = this.createClient();
    this.connected = false;
  }

  async connect(timeoutMs: number = CONNECT_TIMEOUT): Promise<void> {
    if (this.connected) return;

    try {
      logger.info(`Connecting to ${this.serverName}...`);

      // Create transport based on config
      if (isMaybeStdioConfig(this.config)) {
        const transport = buildStdioTransport(this.config, {
          remoteOnly: IS_MCP_SERVER_REMOTE_ONLY,
          extraEnv: this.oauthTokens,
        });

        await withTimeout(this.client.connect(transport), timeoutMs);
      } else if (isMaybeRemoteConfig(this.config)) {
        this.oauthProvider = new PgOAuthClientProvider({
          name: this.serverName,
          mcpServerId: this.serverId,
          serverUrl: this.config.url,
          _clientMetadata: {
            client_name: `Keinsaas Navigator - ${this.serverName}`,
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            token_endpoint_auth_method: "none", // PKCE flow
            scope: MCP_OAUTH_SCOPE,
            redirect_uris: [`${BASE_URL}/api/mcp/oauth/callback`],
            software_id: "keinsaas-navigator",
            software_version: "1.0.0",
          },
          onRedirectToAuthorization: async (authorizationUrl: URL) => {
            logger.warn(
              `OAuth authorization required for ${this.serverName}. Server needs re-authentication.`,
            );
            // Classifiable error so the /mcp list route maps this to the
            // "authorizing" status and re-surfaces the Authorize affordance.
            throw new OAuthAuthorizationRequiredError(authorizationUrl);
          },
        });

        const remoteOptions = { authProvider: this.oauthProvider };

        const connectStreamable = async () => {
          const transport = buildStreamableHttpTransport(
            this.config,
            remoteOptions,
          );
          await withTimeout(this.client.connect(transport), timeoutMs);
        };

        try {
          await retryMcpSessionOnce(connectStreamable, async () => {
            logger.warn(
              `MCP session was lost for ${this.serverName}; re-initializing once`,
            );
            await this.resetClient();
          });
        } catch (streamableError: any) {
          if (shouldFallbackToSse(streamableError, this.config.url)) {
            logger.warn(
              `Streamable HTTP is unsupported for ${this.serverName}; trying legacy SSE`,
            );
            await this.resetClient();
            const transport = buildSseTransport(this.config, remoteOptions);
            await withTimeout(this.client.connect(transport), timeoutMs);
          } else {
            throw streamableError;
          }
        }
      } else {
        throw new Error("Invalid MCP server config");
      }

      // List available tools (time-boxed so a server that connects but hangs
      // on introspection can't stall the request either).
      const result = await withTimeout(this.client.listTools(), timeoutMs);
      this.toolInfo = (result as { tools: MCPToolInfo[] }).tools;

      this.connected = true;
      logger.info(
        `Connected to ${this.serverName}, ${this.toolInfo.length} tools available`,
      );
    } catch (error: any) {
      logger.error(`Failed to connect to ${this.serverName}:`, error);
      await this.oauthProvider?.abortPendingRefresh();
      await this.resetClient();
      throw error;
    }
  }

  async callTool(
    toolName: string,
    params: any,
    signal?: AbortSignal,
  ): Promise<any> {
    if (!this.connected) {
      await this.connect();
    }

    logger.info(`Calling tool ${toolName}...`);

    // The call is bounded by CALL_TIMEOUT and, when the caller supplies one,
    // its abort signal (client disconnect / stop button / streamText timeout).
    // The MCP SDK cancels the in-flight request when this signal fires, so a
    // hung endpoint no longer rides to the outer stream limit.
    const timeout = AbortSignal.timeout(CALL_TIMEOUT);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    try {
      const execute = () =>
        this.client.callTool({ name: toolName, arguments: params }, undefined, {
          signal: combined,
        });

      return await retryMcpSessionOnce(execute, async () => {
        // A lost session is worth one reconnect; an abort/timeout is not.
        if (combined.aborted) throw new Error(`Tool call aborted: ${toolName}`);
        logger.warn(
          `MCP session was lost while calling ${toolName}; re-initializing once`,
        );
        await this.resetClient();
        await this.connect();
      });
    } catch (error: any) {
      logger.error(`Tool call failed: ${toolName}`, error);
      throw error;
    }
  }

  getToolInfo(): MCPToolInfo[] {
    return this.toolInfo;
  }

  async disconnect(): Promise<void> {
    try {
      await this.oauthProvider?.abortPendingRefresh();
      await this.client.close();
      logger.info(`Disconnected from ${this.serverName}`);
    } catch (error) {
      logger.error(`Error disconnecting from ${this.serverName}:`, error);
    } finally {
      this.connected = false;
      this.client = this.createClient();
    }
  }
}

/**
 * Factory function to create ephemeral MCP clients
 * Loads config and OAuth tokens from DB
 */
export async function createEphemeralMCPClient(
  mcpServerId: string,
  userId: string,
  opts?: { organizationId?: string | null },
): Promise<EphemeralMCPClient | null> {
  try {
    // 1. Load server config from DB. Access follows the repository rule
    // (owner, or org-shared "public" within the caller's active org); callers
    // that don't pass an organizationId keep the previous owner-only behavior.
    const server = await pgDb.query.McpServerTable.findFirst({
      where: and(
        eq(McpServerTable.id, mcpServerId),
        eq(McpServerTable.enabled, true),
      ),
    });

    if (!server || !isMcpServerInScope(server, userId, opts?.organizationId)) {
      logger.warn(`MCP server ${mcpServerId} not found for user ${userId}`);
      return null;
    }

    assertServerCanExecuteMcpConfig(
      server.config as MCPServerConfig,
      IS_MCP_SERVER_REMOTE_ONLY,
    );

    // 2. Load OAuth tokens (if exists)
    const oauthSession = await pgDb.query.McpOAuthSessionTable.findFirst({
      where: and(
        eq(McpOAuthSessionTable.mcpServerId, mcpServerId),
        isNotNull(McpOAuthSessionTable.tokens),
      ),
      orderBy: [desc(McpOAuthSessionTable.updatedAt)],
    });

    // 3. Create ephemeral client
    const client = new EphemeralMCPClient(
      server.id,
      server.name,
      server.config as MCPServerConfig,
      oauthSession?.tokens,
    );

    return client;
  } catch (error) {
    logger.error("Failed to create ephemeral MCP client:", error);
    throw error;
  }
}
