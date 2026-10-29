import { MCPServerInfo, MCPToolInfo } from "app-types/mcp";
import { mcpRepository, mcpOAuthRepository } from "lib/db/repository";
import { withAuth } from "auth/route-guard";
import {
  createEphemeralMCPClient,
  MCP_INTROSPECT_TIMEOUT,
} from "lib/ai/mcp/ephemeral-client";
import {
  canExecuteMcpOnServer,
  isOAuthAuthorizationRequired,
  isUnauthorized,
} from "@keinsaas/mcp-router";
import { IS_MCP_SERVER_REMOTE_ONLY } from "lib/const";
import type { MCPServerConfig } from "app-types/mcp";
import {
  isMcpServerCircuitOpen,
  recordMcpServerSuccess,
  recordMcpServerFailure,
} from "lib/ai/mcp/mcp-circuit-breaker";
import globalLogger from "logger";
import { colorize } from "consola/utils";

const logger = globalLogger.withDefaults({
  message: colorize("blue", "[MCP List]: "),
});

/**
 * Stateless MCP List endpoint
 * Returns MCP servers directly from DB with tools loaded via ephemeral clients
 */
export const GET = withAuth(async (_request, session) => {
  const currentUser = session.user;
  const activeOrganizationId = (
    session.session as { activeOrganizationId?: string | null } | undefined
  )?.activeOrganizationId;

  // Load servers directly from DB (stateless)
  const servers = await mcpRepository.selectAllForUser(
    currentUser.id,
    activeOrganizationId,
  );

  logger.info(
    `Loading tools for ${servers.length} MCP servers (user: ${currentUser.id.slice(0, 8)})`,
  );

  // Load tools for each server in parallel
  const result = await Promise.all(
    servers.map(async (server): Promise<MCPServerInfo> => {
      let toolInfo: MCPToolInfo[] = [];
      let status: MCPServerInfo["status"] = server.enabled
        ? "connected"
        : "disconnected";
      let error: string | undefined = undefined;

      if (server.enabled) {
        if (
          !canExecuteMcpOnServer(
            server.config as MCPServerConfig,
            IS_MCP_SERVER_REMOTE_ONLY,
          )
        ) {
          return {
            id: server.id,
            name: server.name,
            config: server.config,
            userId: server.userId,
            visibility: server.visibility,
            enabled: server.enabled ?? true,
            status: "disconnected",
            error: "Requires desktop app for local (stdio) execution",
            toolInfo: [],
            createdAt: server.createdAt,
            updatedAt: server.updatedAt,
          };
        }

        // Skip servers whose circuit is open (recently unreachable) so one
        // dead server can't make the whole MCP page wait out the timeout on
        // every load. It still renders, marked disconnected, and is retried
        // after the cooldown.
        if (isMcpServerCircuitOpen(server.id)) {
          logger.warn(
            `${server.name} skipped (circuit open / recently unreachable)`,
          );
          return {
            id: server.id,
            name: server.name,
            config: server.config,
            userId: server.userId,
            visibility: server.visibility,
            enabled: server.enabled ?? true,
            status: "disconnected",
            error: "Recently unreachable — temporarily skipped",
            toolInfo: [],
            createdAt: server.createdAt,
            updatedAt: server.updatedAt,
          };
        }

        // Check OAuth status BEFORE attempting connection (old architecture approach)
        const needsOAuth = "url" in server.config; // Remote server needs OAuth

        if (needsOAuth) {
          const oauthSession = await mcpOAuthRepository.getAuthenticatedSession(
            server.id,
          );

          if (!oauthSession?.tokens) {
            // Server needs authorization - don't try to connect
            logger.info(
              `${server.name} needs OAuth authorization, skipping connection`,
            );
            return {
              id: server.id,
              name: server.name,
              config: server.config,
              userId: server.userId,
              visibility: server.visibility,
              enabled: server.enabled ?? true,
              status: "authorizing",
              error: "OAuth authorization required",
              toolInfo: [],
              createdAt: server.createdAt,
              updatedAt: server.updatedAt,
            };
          }
        }

        // OAuth is complete (or not needed), safe to connect
        try {
          const client = await createEphemeralMCPClient(
            server.id,
            currentUser.id,
          );
          if (client) {
            // Short introspection timeout so a slow/unreachable server fails
            // fast instead of holding the whole page response for 30s.
            await client.connect(MCP_INTROSPECT_TIMEOUT);
            toolInfo = client.getToolInfo();
            await client.disconnect();
            recordMcpServerSuccess(server.id);
            status = "connected";
            logger.info(`Loaded ${toolInfo.length} tools from ${server.name}`);
          } else {
            status = "disconnected";
            error = "Failed to create client";
          }
        } catch (err: any) {
          const message = err?.message ?? "";
          if (/refresh lock/i.test(message)) {
            // Another instance holds the OAuth refresh lock — transient, the
            // next probe retries. Not a connectivity failure, so no breaker hit.
            logger.warn(
              `${server.name} is refreshing its OAuth token, retrying soon`,
            );
            status = "loading";
            error = "Refreshing authorization…";
          } else if (
            needsOAuth &&
            (isOAuthAuthorizationRequired(err) || isUnauthorized(err))
          ) {
            // Remote server had tokens but the server rejected them (expired,
            // revoked, or a stale registration after a domain move). Surface the
            // existing Authorize affordance instead of a dead "Disconnected".
            logger.info(`${server.name} needs re-authorization`);
            status = "authorizing";
            error = "Authorization expired — please re-authorize";
          } else {
            // Genuine connectivity failure — record it so the breaker can skip
            // this server on the next load.
            recordMcpServerFailure(server.id, server.name);
            logger.error(`Failed to load tools for ${server.name}:`, err);
            status = "disconnected";
            error = err.message || "Connection failed";
          }
          // Keep toolInfo as [] on error
        }
      }

      return {
        id: server.id,
        name: server.name,
        config: server.config,
        userId: server.userId,
        visibility: server.visibility,
        enabled: server.enabled ?? true,
        status,
        error,
        toolInfo,
        createdAt: server.createdAt,
        updatedAt: server.updatedAt,
      };
    }),
  );

  const totalTools = result.reduce((sum, s) => sum + s.toolInfo.length, 0);
  logger.info(`Total tools loaded: ${totalTools}`);

  return Response.json(result);
});

// Increase timeout for tool loading
export const maxDuration = 60; // 60s for Vercel Pro - allows multiple server connections
