import type { ChatMention } from "app-types/chat";
import type { VercelAIMcpTool } from "app-types/mcp";
import { describe, expect, it } from "vitest";
import { buildOpenAIRealtimeToolSetup } from "./openai-tools";

const TWENTY_ID = "11111111-1111-4111-8111-111111111111";

function createTool(
  toolName: string,
  overrides: Partial<VercelAIMcpTool> = {},
): VercelAIMcpTool {
  return {
    description: `Twenty ${toolName}`,
    inputSchema: {
      jsonSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
    execute: async () => ({}),
    _mcpServerName: "Twenty CRM",
    _mcpServerId: TWENTY_ID,
    _originToolName: toolName,
    _readOnlyHint: true,
    ...overrides,
  } as VercelAIMcpTool;
}

function toolMention(name: string): ChatMention {
  return {
    type: "mcpTool",
    serverId: TWENTY_ID,
    serverName: "Twenty CRM",
    name,
    description: `Twenty ${name}`,
  };
}

describe("buildOpenAIRealtimeToolSetup", () => {
  it("normalizes names and schemas and creates an execution map", () => {
    const setup = buildOpenAIRealtimeToolSetup({
      mcpTools: { deals: createTool("find deals") },
      requestedMentions: [toolMention("find deals")],
      includeDefaultVoiceTools: false,
    });

    expect(setup.tools).toEqual([
      expect.objectContaining({
        name: "Twenty_CRM_find_deals",
        type: "function",
        parameters: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      }),
    ]);
    expect(setup.toolExecutionMap.Twenty_CRM_find_deals).toEqual({
      mcpServerId: TWENTY_ID,
      mcpServerName: "Twenty CRM",
      toolName: "find deals",
    });
    expect(setup.toolStatus.available).toEqual([
      expect.objectContaining({
        serverId: TWENTY_ID,
        toolName: "find deals",
        exposedName: "Twenty_CRM_find_deals",
      }),
    ]);
    expect(setup.toolStatus.unavailable).toEqual([]);
  });

  it("reports partially and fully unavailable selections", () => {
    const partial = buildOpenAIRealtimeToolSetup({
      mcpTools: { deals: createTool("findDeals") },
      requestedMentions: [toolMention("findDeals"), toolMention("getDeal")],
      includeDefaultVoiceTools: false,
    });
    expect(partial.toolStatus.available).toHaveLength(1);
    expect(partial.toolStatus.unavailable).toEqual([
      expect.objectContaining({ toolName: "getDeal" }),
    ]);

    const unavailable = buildOpenAIRealtimeToolSetup({
      mcpTools: {},
      requestedMentions: [toolMention("findDeals")],
      includeDefaultVoiceTools: false,
    });
    expect(unavailable.toolStatus.available).toEqual([]);
    expect(unavailable.toolStatus.unavailable).toHaveLength(1);
  });

  it("appends app tools with app-kind execution targets when enabled", () => {
    const setup = buildOpenAIRealtimeToolSetup({
      mcpTools: { deals: createTool("find deals") },
      includeDefaultVoiceTools: false,
      includeAppTools: true,
    });

    const names = setup.tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Twenty_CRM_find_deals",
        "list_agents",
        "activateAgent",
        "list_projects",
        "get_project_status",
        "send_chat_message",
        "add_project_member",
        "load_skill",
        "cockpit_summary",
      ]),
    );
    expect(setup.toolExecutionMap.list_agents).toEqual({
      kind: "app",
      toolName: "list_agents",
    });
    // Browser-handled tools must not be routed to the server executor.
    expect(setup.toolExecutionMap.activateAgent).toBeUndefined();
    // MCP entries stay kind-less (treated as "mcp").
    expect(setup.toolExecutionMap.Twenty_CRM_find_deals).toEqual({
      mcpServerId: TWENTY_ID,
      mcpServerName: "Twenty CRM",
      toolName: "find deals",
    });
  });

  it("omits app tools by default", () => {
    const setup = buildOpenAIRealtimeToolSetup({
      mcpTools: {},
      includeDefaultVoiceTools: false,
    });
    expect(setup.tools).toEqual([]);
    expect(setup.toolExecutionMap.list_agents).toBeUndefined();
  });

  /**
   * Fails closed: a caller that forgets to resolve the org policy offers fewer
   * tools, never more. Realtime tools are frozen at connect time, so an
   * accidental default of "on" would hand every workspace a browser.
   */
  it("withholds the browser tools unless the capability is passed", () => {
    const off = buildOpenAIRealtimeToolSetup({
      mcpTools: {},
      includeDefaultVoiceTools: false,
      includeAppTools: true,
    });
    expect(off.tools.map((tool) => tool.name)).not.toContain("browseWeb");

    const on = buildOpenAIRealtimeToolSetup({
      mcpTools: {},
      includeDefaultVoiceTools: false,
      includeAppTools: true,
      appToolCapabilities: { browserAutomation: true },
    });
    const names = on.tools.map((tool) => tool.name);
    expect(names).toContain("browseWeb");
    expect(names).toContain("checkBrowserRun");
    // Both are handled inline by the voice hook, not by POST /api/voice/tool.
    expect(on.toolExecutionMap.browseWeb).toBeUndefined();
    expect(on.toolExecutionMap.checkBrowserRun).toBeUndefined();
  });

  /**
   * The Tool Router hands back four meta-tools whatever is connected, so unlike
   * a per-action toolset they fit a session config that is re-sent every turn.
   */
  describe("composio tools", () => {
    const searchTool = {
      description: "Search for tools",
      inputSchema: {
        jsonSchema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
    };

    it("appends them last with composio-kind execution targets", () => {
      const setup = buildOpenAIRealtimeToolSetup({
        mcpTools: { deals: createTool("find deals") },
        includeDefaultVoiceTools: false,
        includeAppTools: true,
        composioTools: { COMPOSIO_SEARCH_TOOLS: searchTool },
      });

      const names = setup.tools.map((tool) => tool.name);
      expect(names.at(-1)).toBe("COMPOSIO_SEARCH_TOOLS");
      expect(setup.toolExecutionMap.COMPOSIO_SEARCH_TOOLS).toEqual({
        kind: "composio",
        toolName: "COMPOSIO_SEARCH_TOOLS",
      });
      // The parameters have to survive: an empty object schema would leave the
      // model calling a search tool with no query.
      expect(
        setup.tools.find((tool) => tool.name === "COMPOSIO_SEARCH_TOOLS")
          ?.parameters,
      ).toEqual({
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      });
    });

    it("accepts a raw JSON Schema as well as a wrapped one", () => {
      const setup = buildOpenAIRealtimeToolSetup({
        mcpTools: {},
        includeDefaultVoiceTools: false,
        composioTools: {
          COMPOSIO_EXECUTE_TOOL: {
            description: "Execute a tool",
            inputSchema: {
              type: "object",
              properties: { slug: { type: "string" } },
            },
          },
        },
      });

      expect(setup.tools[0]).toEqual({
        name: "COMPOSIO_EXECUTE_TOOL",
        type: "function",
        description: "Execute a tool",
        parameters: {
          type: "object",
          properties: { slug: { type: "string" } },
          required: [],
        },
      });
    });

    /**
     * Unlike an MCP collision, which throws, a bad Composio tool is dropped:
     * its names come over the network from a vendor and cannot be fixed here,
     * and losing one integration tool beats refusing to open the microphone.
     */
    it("drops unusable schemas and names already taken", () => {
      const setup = buildOpenAIRealtimeToolSetup({
        mcpTools: {},
        includeDefaultVoiceTools: false,
        includeAppTools: true,
        composioTools: {
          BROKEN: { description: "no schema at all" },
          NOT_AN_OBJECT: { inputSchema: { jsonSchema: { type: "string" } } },
          list_agents: searchTool,
        },
      });

      const names = setup.tools.map((tool) => tool.name);
      expect(names).not.toContain("BROKEN");
      expect(names).not.toContain("NOT_AN_OBJECT");
      // The app tool keeps the name; the Composio one is dropped rather than
      // allowed to mis-route at execution time.
      expect(setup.toolExecutionMap.list_agents).toEqual({
        kind: "app",
        toolName: "list_agents",
      });
    });

    /**
     * A name OpenAI rejects does not cost one tool — the session config is
     * validated as a whole, so it fails the connect and there is no voice chat
     * at all. These names come raw from a vendor's router.
     */
    it("drops names OpenAI would reject rather than risk the connect", () => {
      const setup = buildOpenAIRealtimeToolSetup({
        mcpTools: {},
        includeDefaultVoiceTools: false,
        composioTools: {
          "GMAIL.SEND": searchTool,
          "has space": searchTool,
          [`X${"y".repeat(64)}`]: searchTool,
          COMPOSIO_SEARCH_TOOLS: searchTool,
        },
      });

      expect(setup.tools.map((tool) => tool.name)).toEqual([
        "COMPOSIO_SEARCH_TOOLS",
      ]);
      expect(setup.toolExecutionMap["GMAIL.SEND"]).toBeUndefined();
    });

    it("offers none by default", () => {
      const setup = buildOpenAIRealtimeToolSetup({
        mcpTools: {},
        includeDefaultVoiceTools: false,
      });
      expect(setup.tools).toEqual([]);
    });
  });

  it("rejects invalid schemas and normalized name collisions", () => {
    expect(() =>
      buildOpenAIRealtimeToolSetup({
        mcpTools: {
          invalid: createTool("findDeals", {
            inputSchema: { jsonSchema: { type: "string" } } as never,
          }),
        },
        includeDefaultVoiceTools: false,
      }),
    ).toThrow("must use an object input schema");

    expect(() =>
      buildOpenAIRealtimeToolSetup({
        mcpTools: {
          first: createTool("find deals"),
          second: createTool("find@deals"),
        },
        includeDefaultVoiceTools: false,
      }),
    ).toThrow('Duplicate realtime tool name "Twenty_CRM_find_deals"');
  });
});
