import "server-only";
import {
  canExecuteMcpOnServer,
  isOAuthAuthorizationRequired,
} from "@keinsaas/mcp-router";
import { jsonSchema } from "ai";
import { ChatMention } from "app-types/chat";
import {
  AllowedMCPServer,
  type MCPServerConfig,
  McpServerCustomizationsPrompt,
  VercelAIMcpTool,
  VercelAIMcpToolTag,
} from "app-types/mcp";
import { IS_MCP_SERVER_REMOTE_ONLY } from "lib/const";
import { objectFlow } from "lib/utils";
import logger from "logger";

export function filterMCPToolsByMentions(
  tools: Record<string, VercelAIMcpTool>,
  mentions: ChatMention[],
) {
  if (mentions.length === 0) {
    return tools;
  }
  const toolMentions = mentions.filter(
    (mention) => mention.type == "mcpTool" || mention.type == "mcpServer",
  ) as Extract<ChatMention, { type: "mcpTool" | "mcpServer" }>[];

  const metionsByServer = toolMentions.reduce(
    (acc, mention) => {
      if (mention.type == "mcpServer") {
        return {
          ...acc,
          [mention.serverId]: Object.values(tools).map(
            (tool) => tool._originToolName,
          ),
        };
      }
      return {
        ...acc,
        [mention.serverId]: [...(acc[mention.serverId] ?? []), mention.name],
      };
    },
    {} as Record<string, string[]>,
  );

  return objectFlow(tools).filter((_tool) => {
    if (!metionsByServer[_tool._mcpServerId]) return false;
    return metionsByServer[_tool._mcpServerId].includes(_tool._originToolName);
  });
}

export function filterMCPToolsByAllowedMCPServers(
  tools: Record<string, VercelAIMcpTool>,
  allowedMcpServers?: Record<string, AllowedMCPServer>,
): Record<string, VercelAIMcpTool> {
  if (!allowedMcpServers || Object.keys(allowedMcpServers).length === 0) {
    return {};
  }
  return objectFlow(tools).filter((_tool) => {
    if (!allowedMcpServers[_tool._mcpServerId]?.tools) return false;
    return allowedMcpServers[_tool._mcpServerId].tools.includes(
      _tool._originToolName,
    );
  });
}

export function filterMcpServerCustomizations(
  tools: Record<string, VercelAIMcpTool>,
  mcpServerCustomization: Record<string, McpServerCustomizationsPrompt>,
): Record<string, McpServerCustomizationsPrompt> {
  const toolNamesByServerId = Object.values(tools).reduce(
    (acc, tool) => {
      if (!acc[tool._mcpServerId]) acc[tool._mcpServerId] = [];
      acc[tool._mcpServerId].push(tool._originToolName);
      return acc;
    },
    {} as Record<string, string[]>,
  );

  return Object.entries(mcpServerCustomization).reduce(
    (acc, [serverId, mcpServerCustomization]) => {
      if (!(serverId in toolNamesByServerId)) return acc;

      if (
        !mcpServerCustomization.prompt &&
        !Object.keys(mcpServerCustomization.tools ?? {}).length
      )
        return acc;

      const prompts: McpServerCustomizationsPrompt = {
        id: serverId,
        name: mcpServerCustomization.name,
        prompt: mcpServerCustomization.prompt,
        tools: mcpServerCustomization.tools
          ? objectFlow(mcpServerCustomization.tools).filter((_, key) => {
              return toolNamesByServerId[serverId].includes(key as string);
            })
          : {},
      };

      acc[serverId] = prompts;

      return acc;
    },
    {} as Record<string, McpServerCustomizationsPrompt>,
  );
}

/**
 * @deprecated Use loadMcpToolsStateless instead
 * Legacy stateful version using globalThis manager
 */
/**
 * @deprecated Use loadMcpToolsStateless instead
 * This is kept only for feature flag fallback (USE_STATELESS_MCP=false)
 */
export const loadMcpTools = async (
  userId: string,
  opt?: {
    mentions?: ChatMention[];
    allowedMcpServers?: Record<string, AllowedMCPServer>;
    organizationId?: string | null;
  },
): Promise<Record<string, VercelAIMcpTool>> => {
  logger.warn(
    "loadMcpTools is deprecated. Using fallback to stateless loader.",
  );
  // Fallback to stateless loader
  return loadMcpToolsStateless(userId, opt);
};

/**
 * NEW: Stateless MCP tool loading for Vercel
 * Loads tools fresh from DB per request, no memory state
 */
export const loadMcpToolsStateless = async (
  userId: string,
  opt?: {
    mentions?: ChatMention[];
    allowedMcpServers?: Record<string, AllowedMCPServer>;
    organizationId?: string | null;
    /**
     * Return every reachable server's tools when neither mentions nor an
     * allow-map narrow the set. Without this the final filter yields {} — the
     * right default for chat (nothing selected means nothing enabled) but not
     * for the voice UI, which has no tool picker.
     */
    includeAllServers?: boolean;
  },
): Promise<Record<string, VercelAIMcpTool>> => {
  try {
    if (!userId) throw new Error("User ID required for MCP tools");

    // Import here to avoid circular dependencies
    const { pgDb } = await import("lib/db/pg/db.pg");
    const { McpServerTable } = await import("lib/db/pg/schema.pg");
    const { eq, and, or } = await import("drizzle-orm");
    const { isMcpServerInScope } = await import("lib/ai/mcp/mcp-server-scope");
    const { createEphemeralMCPClient, MCP_INTROSPECT_TIMEOUT } = await import(
      "lib/ai/mcp/ephemeral-client"
    );
    const {
      isMcpServerCircuitOpen,
      recordMcpServerSuccess,
      recordMcpServerFailure,
    } = await import("lib/ai/mcp/mcp-circuit-breaker");
    const {
      peekMcpToolInfo,
      loadMcpToolInfoCached,
      rememberMcpToolLoadFailure,
    } = await import("lib/ai/mcp/mcp-tools-cache");

    // 1. Load server configs from DB: own servers plus shared ("public")
    // servers in the caller's active org — the same predicate the repository
    // layer uses (selectAllForUser). No org fails closed to owner-only. The
    // in-code scope filter is defense in depth for the same rule.
    const organizationId = opt?.organizationId ?? null;
    const scopeWhere = organizationId
      ? or(
          eq(McpServerTable.userId, userId),
          and(
            eq(McpServerTable.visibility, "public"),
            eq(McpServerTable.organizationId, organizationId),
          ),
        )
      : eq(McpServerTable.userId, userId);
    const servers = (
      await pgDb.query.McpServerTable.findMany({
        where: and(scopeWhere, eq(McpServerTable.enabled, true)),
      })
    ).filter((server) => isMcpServerInScope(server, userId, organizationId));

    if (servers.length === 0) {
      return {};
    }

    // 2. Filter by allowed servers if specified
    let filteredServers = servers;
    if (
      opt?.allowedMcpServers &&
      Object.keys(opt.allowedMcpServers).length > 0
    ) {
      const allowedIds = Object.keys(opt.allowedMcpServers);
      filteredServers = servers.filter((s) => allowedIds.includes(s.id));
    }

    const mentionedServerIds = new Set(
      opt?.mentions
        ?.filter(
          (mention) =>
            mention.type === "mcpTool" || mention.type === "mcpServer",
        )
        .map((mention) => mention.serverId) ?? [],
    );
    if (mentionedServerIds.size > 0) {
      filteredServers = filteredServers.filter((server) =>
        mentionedServerIds.has(server.id),
      );
    }

    filteredServers = filteredServers.filter((server) =>
      canExecuteMcpOnServer(
        server.config as MCPServerConfig,
        IS_MCP_SERVER_REMOTE_ONLY,
      ),
    );

    // 3. Load tools from each server (parallel)
    const toolsPromises = filteredServers.map(async (server) => {
      // Cache is versioned by the row's updatedAt, so a config save is a miss.
      const version = String(
        (server.updatedAt as Date | undefined)?.getTime?.() ??
          server.updatedAt ??
          "",
      );

      // Cache hit: build tools from the memoized tool list, skip connect.
      let toolInfo = peekMcpToolInfo(server.id, version) as ReturnType<
        typeof peekMcpToolInfo
      > | null;

      if (!toolInfo) {
        // Skip servers whose circuit is open (recently unreachable) so one dead
        // server can't keep stalling chat TTFT with the connect timeout.
        if (isMcpServerCircuitOpen(server.id)) {
          logger.warn(
            `MCP server "${server.name}" skipped (circuit open / recently unreachable)`,
          );
          return { serverId: server.id, tools: {} };
        }

        toolInfo = await loadMcpToolInfoCached(server.id, version, async () => {
          const serverStart = performance.now();
          const client = await createEphemeralMCPClient(server.id, userId, {
            organizationId,
          });
          if (!client) {
            throw new Error(`MCP client unavailable for "${server.name}"`);
          }

          // Short introspection timeout (not the 30s execution timeout) so a
          // slow/unreachable server fails fast instead of blocking first token.
          await client.connect(MCP_INTROSPECT_TIMEOUT);
          const info = client.getToolInfo();
          await client.disconnect();
          recordMcpServerSuccess(server.id);

          // Per-server connect+introspect latency, surfaced individually.
          const serverMs = Math.round(performance.now() - serverStart);
          if (serverMs > 1000) {
            logger.warn(
              `MCP server "${server.name}" slow to load tools: ${serverMs}ms (${info.length} tools)`,
            );
          }
          return info;
        }).catch((error) => {
          // OAuth authorization required is an expected condition (server is
          // reachable but the user hasn't authorized yet). Do not penalize the
          // circuit breaker — it should only trip on genuine connectivity failures.
          if (!isOAuthAuthorizationRequired(error)) {
            recordMcpServerFailure(server.id, server.name);
            // Skip this server on the next request too. The breaker needs three
            // strikes and this process is usually cold, so without this a dead
            // server charges every chat request the full connect timeout.
            rememberMcpToolLoadFailure(server.id, version);
          }
          logger.warn(
            `MCP server "${server.name}" degraded — its tools are unavailable this turn:`,
            error,
          );
          return null;
        });

        if (!toolInfo) return { serverId: server.id, tools: {} };
      }

      // Convert to Vercel AI tools
      const tools: Record<string, VercelAIMcpTool> = {};
      for (const tool of toolInfo) {
        const toolId = `${server.name}_${tool.name}`;
        tools[toolId] = VercelAIMcpToolTag.create({
          description: tool.description,
          inputSchema: jsonSchema({
            ...tool.inputSchema,
            properties: tool.inputSchema?.properties ?? {},
            additionalProperties: false,
          } as any),
          _originToolName: tool.name,
          _mcpServerName: server.name,
          _mcpServerId: server.id,
          _readOnlyHint: tool.annotations?.readOnlyHint === true,
          execute: async (params, options) => {
            // Direct ephemeral client execution (server-side context)
            // Cannot use RPC fetch here because we're already in server context
            // and fetch won't include session/authentication
            const execClient = await createEphemeralMCPClient(
              server.id,
              userId,
              { organizationId },
            );
            if (!execClient) {
              throw new Error("MCP server not found");
            }
            const startedAt = performance.now();
            try {
              const result = await execClient.callTool(
                tool.name,
                params,
                options?.abortSignal,
              );
              logger.info(
                `MCP tool ${toolId} completed in ${Math.round(performance.now() - startedAt)}ms`,
              );
              return result;
            } catch (error) {
              logger.warn(
                `MCP tool ${toolId} ${options?.abortSignal?.aborted ? "aborted" : "failed"} after ${Math.round(performance.now() - startedAt)}ms`,
                error,
              );
              throw error;
            } finally {
              await execClient.disconnect();
            }
          },
        });
      }

      return { serverId: server.id, tools };
    });

    const results = await Promise.all(toolsPromises);

    // 4. Merge all tools
    let allTools: Record<string, VercelAIMcpTool> = {};
    for (const result of results) {
      allTools = { ...allTools, ...result.tools };
    }

    // 5. Filter by mentions OR allowed servers (original OR logic)
    if (opt?.mentions?.length) {
      // Filter by @mentions only
      allTools = filterMCPToolsByMentions(allTools, opt.mentions);
    } else if (
      !opt?.includeAllServers ||
      Object.keys(opt?.allowedMcpServers ?? {}).length > 0
    ) {
      // Otherwise filter by allowed servers
      allTools = filterMCPToolsByAllowedMCPServers(
        allTools,
        opt?.allowedMcpServers,
      );
    }

    return allTools;
  } catch (error) {
    logger.error("Failed to load MCP tools (all servers degraded):", error);
    return {};
  }
};
