import type { ChatMention } from "app-types/chat";
import { describe, expect, it } from "vitest";
import { hasDefaultToolMention, hasMcpMention } from "./mention-tool-scope";

const agent = { type: "agent", agentId: "a", name: "Agent" } as ChatMention;
const defaultTool = { type: "defaultTool", name: "webSearch" } as ChatMention;
const mcpTool = {
  type: "mcpTool",
  serverId: "s",
  name: "t",
  serverName: "S",
} as ChatMention;
const mcpServer = {
  type: "mcpServer",
  serverId: "s",
  name: "S",
} as ChatMention;
const workflow = {
  type: "workflow",
  workflowId: "w",
  name: "W",
} as ChatMention;

describe("mention tool scope", () => {
  it("treats no mentions as pinning nothing", () => {
    expect(hasDefaultToolMention(undefined)).toBe(false);
    expect(hasMcpMention(undefined)).toBe(false);
    expect(hasDefaultToolMention([])).toBe(false);
    expect(hasMcpMention([])).toBe(false);
  });

  /**
   * The regression this module exists for: an agent mention is a persona
   * choice, not a tool pin. Reading it as one left agent turns with no app
   * default tools and no MCP servers at all.
   */
  it("does not let an agent mention pin any tool namespace", () => {
    expect(hasDefaultToolMention([agent])).toBe(false);
    expect(hasMcpMention([agent])).toBe(false);
  });

  it("does not let a workflow mention pin app default or MCP tools", () => {
    expect(hasDefaultToolMention([workflow])).toBe(false);
    expect(hasMcpMention([workflow])).toBe(false);
  });

  it("pins each namespace only from its own mention type", () => {
    expect(hasDefaultToolMention([defaultTool])).toBe(true);
    expect(hasMcpMention([defaultTool])).toBe(false);

    expect(hasMcpMention([mcpTool])).toBe(true);
    expect(hasMcpMention([mcpServer])).toBe(true);
    expect(hasDefaultToolMention([mcpTool])).toBe(false);
  });

  it("keeps namespaces independent when several kinds are mentioned at once", () => {
    const mixed = [agent, defaultTool, mcpServer];
    expect(hasDefaultToolMention(mixed)).toBe(true);
    expect(hasMcpMention(mixed)).toBe(true);
  });
});
