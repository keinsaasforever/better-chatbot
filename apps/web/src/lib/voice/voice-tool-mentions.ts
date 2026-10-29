import type { ChatMention } from "app-types/chat";
import type { AllowedMCPServer, MCPServerInfo } from "app-types/mcp";

type VoiceMentionAgent = {
  instructions?: { mentions?: ChatMention[] } | null;
};

function isMcpMention(
  mention: ChatMention,
): mention is Extract<ChatMention, { type: "mcpTool" | "mcpServer" }> {
  return mention.type === "mcpTool" || mention.type === "mcpServer";
}

/**
 * Builds the MCP mentions a browser voice session requests.
 *
 * - With an agent, the agent's pinned MCP mentions win (tool and whole-server
 *   mentions alike — dropping server mentions would silently strip the agent's
 *   tools).
 * - `agent: null` means an agent is selected but not loaded yet; that returns
 *   no mentions rather than falling through to the default-all branch (the
 *   server resolves the agent's real mentions itself).
 * - Without an agent (`agent: undefined`), a non-empty selection from the chat
 *   tool dropdown (`allowedMcpServers`) is respected. When nothing was ever
 *   selected — the store default, and what the dropdown prune normalizes to —
 *   voice defaults to every connected server instead of zero tools: unlike
 *   chat, the voice UI has no selector of its own, so "no selection" must
 *   mean "everything".
 */
export function buildVoiceToolMentions({
  agent,
  allowedMcpServers,
  mcpList,
}: {
  agent?: VoiceMentionAgent | null;
  allowedMcpServers?: Record<string, AllowedMCPServer>;
  mcpList: MCPServerInfo[];
}): ChatMention[] {
  if (agent === null) {
    return [];
  }
  if (agent) {
    return agent.instructions?.mentions?.filter(isMcpMention) ?? [];
  }

  const hasExplicitSelection = Object.values(allowedMcpServers ?? {}).some(
    (server) => (server.tools?.length ?? 0) > 0,
  );

  if (!hasExplicitSelection) {
    return mcpList
      .filter((server) => server.enabled !== false)
      .map((server) => ({
        type: "mcpServer",
        serverId: server.id,
        name: server.name,
        toolCount: server.toolInfo.length,
      }));
  }

  return mcpList.flatMap((server) => {
    const allowedTools = allowedMcpServers?.[server.id]?.tools ?? [];
    return allowedTools.map((tool) => {
      const toolInfo = server.toolInfo.find((item) => item.name === tool);
      const mention: ChatMention = {
        type: "mcpTool",
        serverName: server.name,
        serverId: server.id,
        name: tool,
        description: toolInfo?.description ?? "",
      };
      return mention;
    });
  });
}
