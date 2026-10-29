"use client";

import { appStore } from "@/app/store";
import { useAgent } from "@/hooks/queries/use-agent";
import { useMcpList } from "@/hooks/queries/use-mcp-list";
import type { ChatMention } from "app-types/chat";
import { buildVoiceToolMentions } from "lib/voice/voice-tool-mentions";
import { useMemo } from "react";

/**
 * The MCP mentions a browser voice session requests, with the agent they came
 * from. `isLoading` holds while the server list is still on its first fetch,
 * when the mentions are about to change.
 */
export function useVoiceToolMentions(agentId?: string) {
  const { data: mcpList = [], isLoading } = useMcpList();
  const allowedMcpServers = appStore((state) => state.allowedMcpServers);
  const { agent } = useAgent(agentId);

  const toolMentions = useMemo<ChatMention[]>(
    () =>
      buildVoiceToolMentions({
        agent: agentId ? (agent ?? null) : undefined,
        allowedMcpServers,
        mcpList,
      }),
    [agentId, agent, mcpList, allowedMcpServers],
  );

  return { toolMentions, agent, isLoading };
}
