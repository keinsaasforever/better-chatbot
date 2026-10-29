import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  type MCPServerConfig,
  type MCPServerInfo,
  type MCPToolInfo,
} from "app-types/mcp";

import type { ConsolaInstance } from "consola";
import { colorize } from "consola/utils";
import {
  Locker,
  createDebounce,
  errorToString,
  generateUUID,
  isNull,
} from "lib/utils";
import logger from "logger";
import { isMaybeRemoteConfig, isMaybeStdioConfig } from "./is-mcp-config";

import {
  OAuthAuthorizationRequiredError,
  buildSseTransport,
  buildStdioTransport,
  buildStreamableHttpTransport,
  isMcpSessionNotFound,
  isOAuthAuthorizationRequired,
  isUnauthorized,
  retryMcpSessionOnce,
  shouldFallbackToSse,
  withTimeout,
} from "@keinsaas/mcp-router";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  BASE_URL,
  IS_MCP_SERVER_REMOTE_ONLY,
  IS_VERCEL_ENV,
  MCP_OAUTH_SCOPE,
} from "lib/const";
import { safe } from "ts-safe";
import { PgOAuthClientProvider } from "./pg-oauth-provider";

type ClientOptions = {
  autoDisconnectSeconds?: number;
};

const CONNET_TIMEOUT = IS_VERCEL_ENV ? 30000 : 120000;
const MCP_MAX_TOTAL_TIMEOUT = process.env.MCP_MAX_TOTAL_TIMEOUT
  ? parseInt(process.env.MCP_MAX_TOTAL_TIMEOUT, 10)
  : undefined;

/**
 * Client class for Model Context Protocol (MCP) server connections
 */
export class MCPClient {
  private client?: Client;
  private error?: unknown;
  private authorizationUrl?: URL;
  protected isConnected = false;
  private logger: ConsolaInstance;
  private locker = new Locker();
  private transport?: Transport;
  private oauthProvider?: PgOAuthClientProvider;
  // Information about available tools from the server
  toolInfo: MCPToolInfo[] = [];
  private disconnectDebounce = createDebounce();
  private needOauthProvider = false;
  private inProgressToolCallIds: string[] = [];
  constructor(
    private id: string,
    private name: string,
    private serverConfig: MCPServerConfig,

    private options: ClientOptions = {},
  ) {
    this.logger = logger.withDefaults({
      message: colorize(
        "cyan",
        `[${this.id.slice(0, 4)}] MCP Client ${this.name}: `,
      ),
    });
  }

  get status() {
    if (this.locker.isLocked) return "loading";
    if (this.authorizationUrl) return "authorizing";
    if (this.isConnected) return "connected";
    return "disconnected";
  }

  get hasActiveToolCalls() {
    return this.inProgressToolCallIds.length > 0;
  }

  getAuthorizationUrl(): URL | undefined {
    return this.authorizationUrl;
  }

  async finishAuth(code: string, state: string) {
    if (!isMaybeRemoteConfig(this.serverConfig))
      throw new Error("OAuth flow requires a remote MCP server");

    if (this.status != "authorizing" || this.oauthProvider?.state() != state) {
      if (this.oauthProvider && this.oauthProvider.state() != state) {
        await this.oauthProvider.adoptState(state);
      } else {
        await this.disconnect();
        await this.connect(state);
      }
    }
    const finish = (this.transport as StreamableHTTPClientTransport)
      ?.finishAuth;

    if (!finish) throw new Error("Not Found finishAuth");

    this.logger.info("OAuth authorization: exchanging code for token");

    await finish.call(this.transport, code);
    this.authorizationUrl = undefined;
    this.logger.info("OAuth authorization: token exchange completed");
  }

  getInfo(): MCPServerInfo {
    return {
      id: this.id,
      name: this.name,
      config: this.serverConfig,
      status: this.status,
      error: this.error,
      toolInfo: this.toolInfo,
      visibility: "private" as const,
      enabled: true,
      userId: "", // This will be filled by the manager
    };
  }

  private createOAuthProvider(oauthState?: string) {
    // Always create OAuth provider for remote servers
    // The provider will check DB for existing tokens automatically
    if (isMaybeRemoteConfig(this.serverConfig)) {
      this.logger.info("Creating OAuth provider for remote MCP server");
      if (this.oauthProvider) {
        if (oauthState && oauthState != this.oauthProvider.state()) {
          this.oauthProvider.adoptState(oauthState);
        }
        return this.oauthProvider;
      }
      this.oauthProvider = new PgOAuthClientProvider({
        name: this.name,
        mcpServerId: this.id,
        serverUrl: this.serverConfig.url,
        state: oauthState,
        _clientMetadata: {
          client_name: `Keinsaas Navigator - ${this.name}`,
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none", // PKCE flow
          scope: MCP_OAUTH_SCOPE,
          redirect_uris: [`${BASE_URL}/api/mcp/oauth/callback`],
          software_id: "keinsaas-navigator",
          software_version: "1.0.0",
        },
        onRedirectToAuthorization: async (authorizationUrl: URL) => {
          this.logger.info(
            "OAuth authorization required - user interaction needed",
          );
          this.authorizationUrl = authorizationUrl;
          throw new OAuthAuthorizationRequiredError(authorizationUrl);
        },
      });
      return this.oauthProvider;
    }
    return undefined;
  }

  private scheduleAutoDisconnect() {
    if (!isNull(this.options.autoDisconnectSeconds)) {
      this.disconnectDebounce(() => {
        // Don't disconnect if there are tool calls in progress
        if (this.inProgressToolCallIds.length === 0) {
          this.disconnect();
        } else {
          this.logger.info(
            `Skipping auto-disconnect: ${this.inProgressToolCallIds.length} tool calls in progress`,
          );
          // Reschedule the disconnect check
          this.scheduleAutoDisconnect();
        }
      }, this.options.autoDisconnectSeconds * 1000);
    }
  }

  async connect(oauthState?: string): Promise<Client | undefined> {
    if (this.status === "loading") {
      await this.locker.wait();
      return this.client;
    }
    if (this.status === "connected") {
      return this.client;
    }
    try {
      const startedAt = Date.now();
      this.locker.lock();
      this.error = undefined;
      this.authorizationUrl = undefined;
      this.isConnected = false;
      this.client = undefined;

      const createSdkClient = () =>
        new Client({
          name: `keinsaas-navigator-${this.name}`,
          version: "1.0.0",
        });
      let client = createSdkClient();

      // Create appropriate transport based on server config type
      if (isMaybeStdioConfig(this.serverConfig)) {
        this.transport = buildStdioTransport(this.serverConfig, {
          remoteOnly: IS_MCP_SERVER_REMOTE_ONLY,
        });

        await withTimeout(
          client.connect(this.transport, {
            maxTotalTimeout: MCP_MAX_TOTAL_TIMEOUT,
          }),
          CONNET_TIMEOUT,
        );
      } else if (isMaybeRemoteConfig(this.serverConfig)) {
        const abortController = new AbortController();
        const authProvider = this.createOAuthProvider(oauthState);
        const remoteOptions = {
          authProvider,
          signal: abortController.signal,
        };

        const connectStreamable = async () => {
          this.transport = buildStreamableHttpTransport(
            this.serverConfig,
            remoteOptions,
          );
          await withTimeout(
            client.connect(this.transport, {
              maxTotalTimeout: MCP_MAX_TOTAL_TIMEOUT,
            }),
            CONNET_TIMEOUT,
          );
        };

        try {
          await retryMcpSessionOnce(connectStreamable, async () => {
            this.logger.warn(
              "MCP session was lost during connection; re-initializing once",
            );
            await client.close().catch(() => undefined);
            client = createSdkClient();
          });
        } catch (streamableHttpError: any) {
          // Check if it's OAuth error and we haven't tried OAuth yet
          if (isUnauthorized(streamableHttpError) && !this.needOauthProvider) {
            this.logger.info(
              "OAuth authentication required, retrying with OAuth provider",
            );
            this.needOauthProvider = true;
            await client.close().catch(() => undefined);
            this.locker.unlock();
            await this.disconnect();
            return this.connect(oauthState); // Recursive call with OAuth
          }

          if (shouldFallbackToSse(streamableHttpError, this.serverConfig.url)) {
            this.logger.warn(
              "Streamable HTTP is unsupported; falling back to legacy SSE",
            );

            await client.close().catch(() => undefined);
            client = createSdkClient();
            this.transport = buildSseTransport(
              this.serverConfig,
              remoteOptions,
            );

            try {
              await withTimeout(
                client.connect(this.transport, {
                  maxTotalTimeout: MCP_MAX_TOTAL_TIMEOUT,
                }),
                CONNET_TIMEOUT,
              );
            } catch (sseError) {
              if (isUnauthorized(sseError) && !this.needOauthProvider) {
                this.logger.info(
                  "OAuth authentication required for SSE, retrying with OAuth provider",
                );
                this.needOauthProvider = true;
                await client.close().catch(() => undefined);
                this.locker.unlock();
                await this.disconnect();
                return this.connect(oauthState); // Recursive call with OAuth
              }

              if (!isOAuthAuthorizationRequired(sseError)) throw sseError;
            }
          } else if (!isOAuthAuthorizationRequired(streamableHttpError)) {
            throw streamableHttpError;
          }
        }
      } else {
        throw new Error("Invalid server config");
      }

      this.logger.info(
        `Connected to MCP server in ${((Date.now() - startedAt) / 1000).toFixed(2)}s`,
      );
      this.client = client;
      this.isConnected = true;

      this.scheduleAutoDisconnect();
    } catch (error) {
      await this.oauthProvider?.abortPendingRefresh();
      this.logger.error(error);
      this.isConnected = false;
      this.error = errorToString(error);
      this.transport = undefined;
      throw error;
    } finally {
      this.locker.unlock();
    }

    await this.updateToolInfo();

    return this.client;
  }

  /**
   * Ensure the underlying OAuth provider adopts the callback state
   * so that PKCE code_verifier matches in multi-instance environments.
   */
  async ensureOAuthState(state: string): Promise<void> {
    if (!state) return;
    await this.oauthProvider?.adoptState(state);
  }

  async disconnect() {
    this.logger.info("Disconnecting from MCP server");
    await this.locker.wait();
    this.isConnected = false;
    const client = this.client;
    this.client = undefined;
    this.transport = undefined;
    await this.oauthProvider?.abortPendingRefresh();
    void client?.close?.().catch((e) => this.logger.error(e));
  }
  async updateToolInfo() {
    if (this.status === "connected" && this.client) {
      this.logger.info("Updating tool info");
      const toolResponse = await this.client.listTools();
      this.toolInfo = toolResponse.tools.map(
        (tool) =>
          ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: tool.annotations,
          }) as MCPToolInfo,
      );
    }
  }

  async callTool(toolName: string, input?: unknown) {
    const id = generateUUID();
    this.inProgressToolCallIds.push(id);
    const execute = async () => {
      const client = await this.connect();
      if (this.status === "authorizing") {
        throw new Error("OAuth authorization required. Try Refresh MCP Client");
      }
      return client?.callTool({
        name: toolName,
        arguments: input as Record<string, unknown>,
      });
    };
    return safe(() => this.logger.info("tool call", toolName))
      .ifOk(() => this.scheduleAutoDisconnect()) // disconnect if autoDisconnectSeconds is set
      .map(() => execute())
      .ifFail(async (err) => {
        if (
          err?.message?.includes("Transport is closed") ||
          isMcpSessionNotFound(err)
        ) {
          this.logger.info("MCP transport/session was lost, reconnecting...");
          await this.disconnect();
          return execute();
        }
        throw err;
      })
      .ifOk((v) => {
        if (isNull(v)) {
          throw new Error("Tool call failed with null");
        }
        return v;
      })
      .ifOk(() => this.scheduleAutoDisconnect())
      .watch(() => {
        this.inProgressToolCallIds = this.inProgressToolCallIds.filter(
          (toolId) => toolId !== id,
        );
      })
      .watch((status) => {
        if (!status.isOk) {
          this.logger.error("Tool call failed", toolName, status.error);
        } else if (status.value?.isError) {
          this.logger.error(
            "Tool call failed content",
            toolName,
            status.value.content,
          );
        }
      })
      .ifFail((err) => {
        return {
          isError: true,
          error: {
            message: errorToString(err),
            name: err?.name || "ERROR",
          },
          content: [],
        };
      })
      .unwrap();
  }
}

/**
 * Factory function to create a new MCP client
 */
export const createMCPClient = (
  id: string,
  name: string,
  serverConfig: MCPServerConfig,
  options: ClientOptions = {},
): MCPClient => new MCPClient(id, name, serverConfig, options);

export { OAuthAuthorizationRequiredError } from "@keinsaas/mcp-router";
