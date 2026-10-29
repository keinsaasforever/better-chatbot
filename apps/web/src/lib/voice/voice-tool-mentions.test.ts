import type { ChatMention } from "app-types/chat";
import type { MCPServerInfo } from "app-types/mcp";
import { describe, expect, it } from "vitest";
import { buildVoiceToolMentions } from "./voice-tool-mentions";

function server(
  id: string,
  name: string,
  tools: string[],
  enabled = true,
): MCPServerInfo {
  return {
    id,
    name,
    config: { url: `https://example.com/${id}` },
    visibility: "private",
    enabled,
    userId: "user-1",
    status: "connected",
    toolInfo: tools.map((toolName) => ({
      name: toolName,
      description: `${toolName} description`,
    })),
  };
}

const mcpList = [
  server("s1", "alpha", ["search", "fetch"]),
  server("s2", "beta", ["transcribe"]),
];

describe("buildVoiceToolMentions", () => {
  it("defaults to all connected servers when nothing was ever selected", () => {
    for (const allowedMcpServers of [undefined, {}]) {
      const mentions = buildVoiceToolMentions({ allowedMcpServers, mcpList });
      expect(mentions).toEqual([
        { type: "mcpServer", serverId: "s1", name: "alpha", toolCount: 2 },
        { type: "mcpServer", serverId: "s2", name: "beta", toolCount: 1 },
      ]);
    }
  });

  it("treats an all-empty selection like no selection", () => {
    const mentions = buildVoiceToolMentions({
      allowedMcpServers: { s1: { tools: [] } },
      mcpList,
    });
    expect(mentions.every((m) => m.type === "mcpServer")).toBe(true);
    expect(mentions).toHaveLength(2);
  });

  it("skips disabled servers in the default set", () => {
    const mentions = buildVoiceToolMentions({
      mcpList: [...mcpList, server("s3", "gamma", ["x"], false)],
    });
    expect(mentions.map((m) => (m as { serverId: string }).serverId)).toEqual([
      "s1",
      "s2",
    ]);
  });

  it("respects an explicit tool selection", () => {
    const mentions = buildVoiceToolMentions({
      allowedMcpServers: { s2: { tools: ["transcribe"] } },
      mcpList,
    });
    expect(mentions).toEqual([
      {
        type: "mcpTool",
        serverName: "beta",
        serverId: "s2",
        name: "transcribe",
        description: "transcribe description",
      },
    ]);
  });

  it("keeps both tool and whole-server mentions from an agent", () => {
    const agentMentions: ChatMention[] = [
      { type: "mcpServer", serverId: "s1", name: "alpha" },
      { type: "mcpTool", serverId: "s2", name: "transcribe" },
      { type: "defaultTool", name: "webSearch", label: "Web Search" },
    ];
    const mentions = buildVoiceToolMentions({
      agent: { instructions: { mentions: agentMentions } },
      allowedMcpServers: { s1: { tools: ["search"] } },
      mcpList,
    });
    expect(mentions).toEqual([
      { type: "mcpServer", serverId: "s1", name: "alpha" },
      { type: "mcpTool", serverId: "s2", name: "transcribe" },
    ]);
  });

  it("returns no mentions for an agent without MCP mentions", () => {
    expect(
      buildVoiceToolMentions({
        agent: { instructions: { mentions: [] } },
        mcpList,
      }),
    ).toEqual([]);
  });

  it("returns no mentions while a selected agent is still loading", () => {
    expect(buildVoiceToolMentions({ agent: null, mcpList })).toEqual([]);
  });
});

// Regression guard for the staging failure: the browser voice UI has no tool
// picker, so an empty server list (SWR still loading, or /api/mcp/list timing
// out on introspection) must not be the thing that decides the session's tool
// set. The server-side default in buildVoiceAgentContext covers that case;
// this test pins the client behavior it relies on.
describe("buildVoiceToolMentions with an unloaded server list", () => {
  it("yields no mentions so the server can apply its own default", () => {
    expect(buildVoiceToolMentions({ mcpList: [] })).toEqual([]);
  });
});
