import { jsonSchema } from "ai";
import type { ChatMention } from "app-types/chat";
import type { VercelAIMcpTool } from "app-types/mcp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  buildVoiceAgentContext: vi.fn(),
  getToken: vi.fn(),
  resolveVoiceBrowserSuppression: vi.fn(),
}));

vi.mock("auth/server", () => ({
  getSession: vi.fn().mockResolvedValue({
    user: { id: "user-1" },
    session: { activeOrganizationId: "organization-1" },
  }),
}));

vi.mock("lib/ai/speech/voice-realtime-config", async (importOriginal) => ({
  // The language parsing is the real one: the tests pin its closed set.
  ...(await importOriginal<
    typeof import("lib/ai/speech/voice-realtime-config")
  >()),
  isAiGatewayConfigured: () => true,
  VOICE_REALTIME_MODEL: "openai/gpt-realtime",
  getAiGatewayTeamIdOrSlug: () => "keinsaas",
}));

vi.mock("lib/ai/speech/voice-gateway.server", () => ({
  getVoiceGateway: () => ({
    experimental_realtime: { getToken: mocks.getToken },
  }),
}));

vi.mock("lib/voice/voice-session", () => ({
  buildVoiceAgentContext: mocks.buildVoiceAgentContext,
}));

// The org AI policy decides whether this session gets the browser tools, and
// it is read here rather than derived, so the tests pin it explicitly.
vi.mock("lib/voice/browser-gate", () => ({
  resolveVoiceBrowserSuppression: mocks.resolveVoiceBrowserSuppression,
}));

import { getVoiceAppToolDefinitions } from "lib/voice/app-tool-definitions";
import { POST } from "./route";

const TWENTY_ID = "11111111-1111-4111-8111-111111111111";

/** The app tools a session gets when browser automation is off. */
const APP_TOOLS_WITHOUT_BROWSER = getVoiceAppToolDefinitions({
  browserAutomation: false,
});
/** Browser-executed app tools (activateAgent) intentionally get no execution-map entry. */
const APP_SERVER_TOOL_COUNT = APP_TOOLS_WITHOUT_BROWSER.filter(
  (definition) => definition.target === "server",
).length;
const DEFAULT_VOICE_TOOL_COUNT = 2;

function mention(name: string): ChatMention {
  return {
    type: "mcpTool",
    serverId: TWENTY_ID,
    serverName: "Twenty",
    name,
    description: name,
  };
}

function tool(name: string): VercelAIMcpTool {
  return {
    description: name,
    inputSchema: jsonSchema({
      type: "object",
      properties: {},
      required: [],
    }),
    execute: async () => ({}),
    _mcpServerName: "Twenty",
    _mcpServerId: TWENTY_ID,
    _originToolName: name,
    _readOnlyHint: true,
  } as VercelAIMcpTool;
}

async function requestSetup(
  body: Record<string, unknown> = {},
  url = "http://localhost/api/chat/openai-realtime",
) {
  const response = await POST(
    new NextRequest(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionOnly: true, ...body }),
    }),
  );
  expect(response.status).toBe(200);
  return response.json();
}

describe("POST /api/chat/openai-realtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveVoiceBrowserSuppression.mockResolvedValue(
      "org policy browser_automation_enabled is off",
    );
  });

  it.each([
    {
      label: "fully available",
      requested: [mention("findDeals")],
      tools: { findDeals: tool("findDeals") },
      available: 1,
      unavailable: 0,
    },
    {
      label: "partially available",
      requested: [mention("findDeals"), mention("getDeal")],
      tools: { findDeals: tool("findDeals") },
      available: 1,
      unavailable: 1,
    },
    {
      label: "unavailable",
      requested: [mention("findDeals")],
      tools: {},
      available: 0,
      unavailable: 1,
    },
  ])(
    "returns tool status and execution mapping when $label",
    async ({ requested, tools, available, unavailable }) => {
      mocks.buildVoiceAgentContext.mockResolvedValue({
        enabledMentions: requested,
        mcpTools: tools,
        composioTools: {},
        systemPrompt: "Be helpful.",
      });

      const payload = await requestSetup();

      expect(payload.toolStatus.requested).toHaveLength(requested.length);
      expect(payload.toolStatus.available).toHaveLength(available);
      expect(payload.toolStatus.unavailable).toHaveLength(unavailable);
      // The realtime session also exposes the app-control tools, so only the
      // MCP portion of the map/tool list scales with `available`.
      expect(Object.keys(payload.toolExecutionMap)).toHaveLength(
        available + APP_SERVER_TOOL_COUNT,
      );
      expect(payload.tools).toHaveLength(
        available + DEFAULT_VOICE_TOOL_COUNT + APP_TOOLS_WITHOUT_BROWSER.length,
      );
      if (available > 0) {
        expect(payload.tools).toContainEqual(
          expect.objectContaining({
            type: "function",
            name: "Twenty_findDeals",
          }),
        );
      }
      expect(mocks.getToken).not.toHaveBeenCalled();
    },
  );

  /**
   * The prompt and the tool list must be given the SAME answer. Telling the
   * model about a browser it was not handed is how you get a promise it cannot
   * keep, and the tools are frozen at connect time so there is no second chance
   * to correct it mid-session.
   */
  describe("browser automation gating", () => {
    beforeEach(() => {
      mocks.buildVoiceAgentContext.mockResolvedValue({
        agent: undefined,
        enabledMentions: [],
        mcpTools: {},
        composioTools: {},
        systemPrompt: "instructions",
      });
    });

    it("withholds the browser tools when the org policy is off", async () => {
      mocks.resolveVoiceBrowserSuppression.mockResolvedValue(
        "org policy browser_automation_enabled is off",
      );
      const payload = await requestSetup();

      const names = payload.tools.map((tool: { name: string }) => tool.name);
      expect(names).not.toContain("browseWeb");
      expect(names).not.toContain("checkBrowserRun");
      expect(payload.browserAutomation).toBe(false);
      expect(mocks.buildVoiceAgentContext).toHaveBeenCalledWith(
        expect.objectContaining({ browserAutomation: false }),
      );
    });

    it("offers them, and says so, when the org policy is on", async () => {
      mocks.resolveVoiceBrowserSuppression.mockResolvedValue(null);
      const payload = await requestSetup();

      const names = payload.tools.map((tool: { name: string }) => tool.name);
      expect(names).toContain("browseWeb");
      expect(names).toContain("checkBrowserRun");
      expect(payload.browserAutomation).toBe(true);
      expect(mocks.buildVoiceAgentContext).toHaveBeenCalledWith(
        expect.objectContaining({ browserAutomation: true }),
      );
      // Both are handled inline by the voice hook, not POST /api/voice/tool.
      expect(payload.toolExecutionMap.browseWeb).toBeUndefined();
      expect(payload.toolExecutionMap.checkBrowserRun).toBeUndefined();
    });
  });

  /**
   * Mentions carry every tool's description, and one is emitted per selected
   * tool. In the query string a workspace with ~80 selected tools produced tens
   * of kilobytes of URL, which the edge rejected with a 414 before the route
   * could log anything. They travel in the body, and only the body.
   */
  describe("request context", () => {
    beforeEach(() => {
      mocks.buildVoiceAgentContext.mockResolvedValue({
        enabledMentions: [],
        mcpTools: {},
        composioTools: {},
        systemPrompt: "Be helpful.",
      });
    });

    it("reads mentions from the body", async () => {
      await requestSetup({ mentions: [mention("findDeals")] });

      expect(mocks.buildVoiceAgentContext).toHaveBeenCalledWith(
        expect.objectContaining({ mentions: [mention("findDeals")] }),
      );
    });

    it("ignores a mentions query param so the URL can never grow with them", async () => {
      const mentions = encodeURIComponent(
        JSON.stringify([mention("fromTheQuery")]),
      );
      await requestSetup(
        {},
        `http://localhost/api/chat/openai-realtime?mentions=${mentions}`,
      );

      expect(mocks.buildVoiceAgentContext).toHaveBeenCalledWith(
        expect.objectContaining({ mentions: [] }),
      );
    });

    /**
     * The AI SDK's realtime transport POSTs the token URL with a body we do not
     * control, so this is the only way the agent reaches the route there. One
     * uuid cannot grow the URL.
     */
    it("still takes the agent id from the query", async () => {
      await requestSetup(
        {},
        "http://localhost/api/chat/openai-realtime?agentId=agent-9",
      );

      expect(mocks.buildVoiceAgentContext).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: "agent-9" }),
      );
    });
  });

  /**
   * The Tool Router returns four meta-tools whatever the user has connected, so
   * the whole integration surface is affordable in a config that is re-sent
   * every turn. Without this the only way to reach a connected app by voice was
   * to delegate to an agent.
   */
  it("offers the user's Composio tools and routes them to their own executor", async () => {
    mocks.buildVoiceAgentContext.mockResolvedValue({
      enabledMentions: [],
      mcpTools: {},
      composioTools: {
        COMPOSIO_SEARCH_TOOLS: {
          description: "Search for tools",
          inputSchema: {
            jsonSchema: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
            },
          },
        },
      },
      systemPrompt: "Be helpful.",
    });

    const payload = await requestSetup();

    expect(mocks.buildVoiceAgentContext).toHaveBeenCalledWith(
      expect.objectContaining({ includeComposio: true }),
    );
    expect(payload.tools).toContainEqual(
      expect.objectContaining({ name: "COMPOSIO_SEARCH_TOOLS" }),
    );
    expect(payload.toolExecutionMap.COMPOSIO_SEARCH_TOOLS).toEqual({
      kind: "composio",
      toolName: "COMPOSIO_SEARCH_TOOLS",
    });
  });
  /**
   * The cockpit opens the drawer with `context: "cockpit"`, which adds the
   * oversight prompt. Only that literal is honoured: anything else a client
   * sends is dropped rather than passed into prompt building.
   */
  describe("session context", () => {
    beforeEach(() => {
      mocks.buildVoiceAgentContext.mockResolvedValue({
        enabledMentions: [],
        mcpTools: {},
        composioTools: {},
        systemPrompt: "Be helpful.",
      });
    });

    it("passes the cockpit context to the session builder", async () => {
      await requestSetup({ context: "cockpit" });
      expect(mocks.buildVoiceAgentContext).toHaveBeenCalledWith(
        expect.objectContaining({ context: "cockpit" }),
      );
    });

    it("hands the client the opening line the copilot speaks first", async () => {
      mocks.buildVoiceAgentContext.mockResolvedValue({
        enabledMentions: [],
        mcpTools: {},
        composioTools: {},
        systemPrompt: "Be helpful.",
        greeting: 'Say exactly "Hi Paul Sir."',
      });
      const payload = await requestSetup({ context: "cockpit" });
      expect(payload.greeting).toBe('Say exactly "Hi Paul Sir."');
    });

    it("sends no opening line when the session builder made none", async () => {
      const payload = await requestSetup();
      expect(payload.greeting).toBeUndefined();
    });

    it.each([undefined, "admin", { cockpit: true }])(
      "ignores any other context (%j)",
      async (context) => {
        await requestSetup({ context });
        expect(mocks.buildVoiceAgentContext).toHaveBeenCalledWith(
          expect.objectContaining({ context: undefined }),
        );
      },
    );
  });

  // The preset's default language picks the prompt's one language rule. A
  // closed set: anything else falls back to German.
  describe("session language", () => {
    beforeEach(() => {
      mocks.buildVoiceAgentContext.mockResolvedValue({
        enabledMentions: [],
        mcpTools: {},
        composioTools: {},
        systemPrompt: "Be helpful.",
      });
    });

    it("passes English through for the Jarvis preset", async () => {
      await requestSetup({ language: "en" });
      expect(mocks.buildVoiceAgentContext).toHaveBeenCalledWith(
        expect.objectContaining({ language: "en" }),
      );
    });

    it.each([undefined, "fr", { en: true }])(
      "falls back to German for anything else (%j)",
      async (language) => {
        await requestSetup({ language });
        expect(mocks.buildVoiceAgentContext).toHaveBeenCalledWith(
          expect.objectContaining({ language: "de" }),
        );
      },
    );
  });

  it("answers a setup failure without its internal message", async () => {
    mocks.buildVoiceAgentContext.mockRejectedValue(
      new Error("connect ECONNREFUSED 10.0.0.5:5432"),
    );
    const response = await POST(
      new NextRequest("http://localhost/api/chat/openai-realtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionOnly: true }),
      }),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to create voice session",
    });
  });
});
