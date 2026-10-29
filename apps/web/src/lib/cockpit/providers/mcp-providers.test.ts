import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("lib/cache", () => ({
  serverCache: { get: async () => undefined, set: async () => {} },
}));

type Tool = {
  name: string;
  inputSchema: { properties: Record<string, unknown>; required?: string[] };
};

const server = vi.hoisted(() => ({
  tools: [] as Tool[],
  results: {} as Record<string, (args: Record<string, unknown>) => unknown>,
  connectError: null as Error | null,
  calls: [] as Array<{ name: string; arguments: Record<string, unknown> }>,
  transportConfig: null as unknown,
}));

vi.mock("@keinsaas/mcp-router", () => ({
  buildStreamableHttpTransport: (config: unknown) => {
    server.transportConfig = config;
    return {};
  },
  OAuthAuthorizationRequiredError: class extends Error {},
}));

// A Navigator MCP server (OAuth handled by Navigator's ephemeral client).
const navigator = vi.hoisted(() => ({
  create: vi.fn(),
  disconnect: vi.fn(async () => {}),
}));
vi.mock("lib/ai/mcp/ephemeral-client", () => ({
  createEphemeralMCPClient: navigator.create,
}));
const oauth = vi.hoisted(() => ({ session: null as null | object }));
vi.mock("lib/db/repository", () => ({
  mcpOAuthRepository: { getAuthenticatedSession: async () => oauth.session },
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    async connect() {
      if (server.connectError) throw server.connectError;
    }
    async listTools() {
      return { tools: server.tools };
    }
    async callTool({
      name,
      arguments: args,
    }: {
      name: string;
      arguments: Record<string, unknown>;
    }) {
      server.calls.push({ name, arguments: args });
      const data = server.results[name]?.(args) ?? null;
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
    async close() {}
  },
}));

const { superlogProvider, summarizeSuperlog } = await import("./superlog");
const { seoProvider, seoArgs } = await import("./seo");
const { OAuthAuthorizationRequiredError } = await import(
  "@keinsaas/mcp-router"
);
const { pickArgs, parseToolResult, mcpReason } = await import("./mcp");
const { StreamableHTTPError } = await import(
  "@modelcontextprotocol/sdk/client/streamableHttp.js"
);
const { McpError, ErrorCode } = await import(
  "@modelcontextprotocol/sdk/types.js"
);

const signal = new AbortController().signal;
const tool = (name: string, props: string[]): Tool => ({
  name,
  inputSchema: {
    properties: Object.fromEntries(props.map((p) => [p, { type: "string" }])),
  },
});

beforeEach(() => {
  server.tools = [];
  server.results = {};
  server.connectError = null;
  server.calls = [];
  server.transportConfig = null;
});

describe("superlog", () => {
  const config = {
    mcpUrl: "https://mcp.superlog.example/mcp",
    token: "sl-token",
  };

  it("reads incidents, alerts and error logs with declared arguments only", async () => {
    const now = Date.now();
    server.tools = [
      tool("search_incidents", ["status", "since", "limit"]),
      tool("list_alerts", ["project_id"]),
      tool("query_logs", ["severity", "range", "limit"]),
    ];
    server.results = {
      search_incidents: (args) =>
        args.status === "open"
          ? {
              count: 1,
              incidents: [
                {
                  id: "i1",
                  title: "Checkout 500s",
                  status: "open",
                  severity: "SEV-2",
                  service: "web",
                  firstSeen: new Date(now - 3_600_000).toISOString(),
                },
              ],
            }
          : {
              count: 2,
              incidents: [
                {
                  id: "i1",
                  title: "Checkout 500s",
                  status: "open",
                  service: "web",
                  firstSeen: new Date(now - 3_600_000).toISOString(),
                },
                {
                  id: "i0",
                  title: "Old",
                  status: "resolved",
                  service: "web",
                  firstSeen: new Date(now - 5 * 86_400_000).toISOString(),
                },
              ],
            },
      list_alerts: () => [
        { id: "a1", state: "firing" },
        { id: "a2", state: "ok" },
      ],
      query_logs: () => [
        { service: "web", severity: "ERROR" },
        { service: "web", severity: "ERROR" },
        { service: "worker", severity: "ERROR" },
      ],
    };
    const feed = await superlogProvider.fetch(config, { signal });
    expect(feed.status).toBe("live");
    if (feed.status !== "live") return;
    expect(feed.data).toMatchObject({
      openIncidents: 1,
      incidents24h: 1,
      firingAlerts: 1,
      errors24h: 3,
    });
    expect(feed.data.services[0]).toEqual({
      name: "web",
      openIncidents: 1,
      errors24h: 2,
    });
    expect(server.transportConfig).toEqual({
      url: config.mcpUrl,
      headers: { Authorization: "Bearer sl-token" },
    });
    // list_alerts declares no matching argument, so nothing is sent.
    expect(
      server.calls.find((c) => c.name === "list_alerts")?.arguments,
    ).toEqual({});
  });

  it("is INOP with the tool name when search_incidents is missing", async () => {
    server.tools = [tool("list_alerts", [])];
    expect(await superlogProvider.fetch(config, { signal })).toEqual({
      status: "inop",
      reason: "toolMissing|search_incidents",
    });
  });

  it("maps an HTTP 401 from the MCP transport to unauthorized", async () => {
    server.connectError = new Error(
      "Error POSTing to endpoint (HTTP 401): invalid token",
    );
    expect(await superlogProvider.probe(config, { signal })).toEqual({
      ok: false,
      reason: "unauthorized",
    });
  });

  it("reads the status the SDK puts on the error code, not the body", async () => {
    // The real SDK error: status on `code`, response body in the message.
    server.connectError = new StreamableHTTPError(
      401,
      'Error POSTing to endpoint: {"error":"invalid_token"}',
    );
    expect(await superlogProvider.probe(config, { signal })).toEqual({
      ok: false,
      reason: "unauthorized",
    });
  });

  it("names the key type when an ingest key is pasted, without calling MCP", async () => {
    server.transportConfig = null;
    const ingest = { ...config, token: "sl_public_abc123" };
    expect(await superlogProvider.probe(ingest, { signal })).toEqual({
      ok: false,
      reason: "wrongKey|superlog_pat_…",
    });
    expect(await superlogProvider.fetch(ingest, { signal })).toEqual({
      status: "inop",
      reason: "wrongKey|superlog_pat_…",
    });
    expect(server.transportConfig).toBeNull();
  });

  it("keeps errors24h empty when no logs tool exists", () => {
    const s = summarizeSuperlog({
      open: [],
      recent: [],
      alerts: null,
      errors: null,
      now: Date.now(),
    });
    expect(s.errors24h).toBeNull();
    expect(s.firingAlerts).toBe(0);
  });
});

describe("seo", () => {
  const config = {
    kind: "dataforseo" as const,
    login: "me@example.com",
    password: "pw",
    domain: "example.com",
    locationName: "Germany",
    languageCode: "de",
  };

  it("matches DataForSEO tools and reads overview, keywords and backlinks", async () => {
    server.tools = [
      tool("dataforseo_labs_google_domain_rank_overview", [
        "target",
        "location_name",
        "language_code",
      ]),
      tool("dataforseo_labs_google_ranked_keywords", [
        "target",
        "location_name",
        "language_code",
        "limit",
      ]),
      tool("backlinks_summary", ["target"]),
    ];
    server.results = {
      dataforseo_labs_google_domain_rank_overview: () => ({
        tasks: [
          {
            result: [
              {
                items: [{ metrics: { organic: { etv: 1234.5, count: 321 } } }],
              },
            ],
          },
        ],
      }),
      dataforseo_labs_google_ranked_keywords: () => ({
        tasks: [
          {
            result: [
              {
                total_count: 321,
                items: [
                  {
                    keyword_data: {
                      keyword: "ki agent",
                      keyword_info: { search_volume: 880 },
                    },
                    ranked_serp_element: { serp_item: { rank_absolute: 4 } },
                    rank_changes: { previous_rank_absolute: 7 },
                  },
                ],
              },
            ],
          },
        ],
      }),
      backlinks_summary: () => ({
        tasks: [{ result: [{ referring_domains: 57 }] }],
      }),
    };
    const feed = await seoProvider.fetch(config, { signal });
    expect(feed.status).toBe("live");
    if (feed.status !== "live") return;
    expect(feed.data).toMatchObject({
      domain: "example.com",
      organicTraffic: 1234.5,
      keywordsCount: 321,
      referringDomains: 57,
    });
    expect(feed.data.topKeywords[0]).toEqual({
      keyword: "ki agent",
      position: 4,
      previousPosition: 7,
      volume: 880,
    });
    const overview = server.calls.find((c) => c.name.includes("overview"));
    expect(overview?.arguments).toEqual({
      target: "example.com",
      location_name: "Germany",
      language_code: "de",
    });
    const auth = (server.transportConfig as { headers: Record<string, string> })
      .headers.Authorization;
    expect(auth).toBe(
      `Basic ${Buffer.from("me@example.com:pw").toString("base64")}`,
    );
  });

  it("is INOP when the server has no domain tools", async () => {
    server.tools = [tool("serp_google_organic_live", ["keyword"])];
    expect(await seoProvider.fetch(config, { signal })).toEqual({
      status: "inop",
      reason: "toolMissing|domain overview",
    });
  });

  describe("over a Navigator MCP server (OpenSEO, OAuth only)", () => {
    const openseo = {
      kind: "openseo" as const,
      mcpServerId: "6f1c1f43-2b4e-4d0e-9a3a-6b1e2d3c4f5a",
      domain: "example.com",
    };
    const scope = { userId: "owner-1", organizationId: "org-1" };
    const connected = (connect: () => Promise<void> = async () => {}) => ({
      connect,
      getToolInfo: () => [
        {
          name: "domain_overview",
          description: "",
          inputSchema: { properties: { domain: { type: "string" } } },
        },
      ],
      callTool: vi.fn(async () => ({
        content: [
          { type: "text", text: JSON.stringify({ organic_traffic: 42 }) },
        ],
      })),
      disconnect: navigator.disconnect,
    });

    beforeEach(() => {
      navigator.create.mockReset();
      navigator.disconnect.mockClear();
      oauth.session = { tokens: { access_token: "t" } };
    });

    it("reads through the server's OAuth session as the connection owner", async () => {
      const client = connected();
      navigator.create.mockResolvedValue(client);
      const feed = await seoProvider.fetch(openseo, { signal, scope });
      expect(feed.status).toBe("live");
      expect(navigator.create).toHaveBeenCalledWith(
        openseo.mcpServerId,
        "owner-1",
        { organizationId: "org-1" },
      );
      expect(client.callTool).toHaveBeenCalledWith(
        "domain_overview",
        { domain: "example.com" },
        signal,
      );
      expect(navigator.disconnect).toHaveBeenCalled();
      // No static-header session was opened.
      expect(server.transportConfig).toBeNull();
    });

    it("asks for a server when OpenSEO has none, without connecting", async () => {
      const { mcpServerId: _none, ...bare } = openseo;
      expect(await seoProvider.fetch(bare, { signal, scope })).toEqual({
        status: "inop",
        reason: "mcpServerMissing",
      });
      expect(navigator.create).not.toHaveBeenCalled();
    });

    it("is INOP when the server is gone or out of the owner's scope", async () => {
      navigator.create.mockResolvedValue(null);
      expect(await seoProvider.probe(openseo, { signal, scope })).toEqual({
        ok: false,
        reason: "mcpServerMissing",
      });
    });

    it("does not connect a server that was never authorized", async () => {
      // Connecting would open a pending OAuth session row on every refresh.
      oauth.session = null;
      const client = connected();
      const connect = vi.spyOn(client, "connect");
      navigator.create.mockResolvedValue(client);
      expect(await seoProvider.fetch(openseo, { signal, scope })).toEqual({
        status: "inop",
        reason: "mcpAuthorize",
      });
      expect(connect).not.toHaveBeenCalled();
    });

    it("asks to authorize the server when its OAuth session is unusable", async () => {
      navigator.create.mockResolvedValue(
        connected(async () => {
          throw new OAuthAuthorizationRequiredError(
            new URL("https://app.openseo.so/authorize"),
          );
        }),
      );
      expect(await seoProvider.fetch(openseo, { signal, scope })).toEqual({
        status: "inop",
        reason: "mcpAuthorize",
      });
      expect(navigator.disconnect).toHaveBeenCalled();
    });
  });
});

describe("mcp helpers", () => {
  it("drops arguments a tool does not declare", () => {
    expect(
      pickArgs(
        { name: "x", properties: { a: {} }, required: [] },
        { a: 1, b: 2, c: undefined },
      ),
    ).toEqual({ a: 1 });
  });

  it("prefers structured content and throws on tool errors", () => {
    expect(parseToolResult({ structuredContent: { n: 1 } })).toEqual({ n: 1 });
    expect(() => parseToolResult({ isError: true, content: [] })).toThrow();
  });

  it("maps MCP failures to precise reasons", () => {
    expect(mcpReason(new StreamableHTTPError(403, "Error POSTing: no"))).toBe(
      "unauthorized",
    );
    expect(mcpReason(new StreamableHTTPError(404, "Error POSTing: x"))).toBe(
      "http|404",
    );
    expect(mcpReason(new StreamableHTTPError(429, "slow down"))).toBe(
      "rateLimited",
    );
    expect(
      mcpReason(new StreamableHTTPError(-1, "Unexpected content type")),
    ).toBe("invalidResponse");
    expect(
      mcpReason(new McpError(ErrorCode.RequestTimeout, "Request timed out")),
    ).toBe("timeout");
    expect(mcpReason(new McpError(ErrorCode.InvalidParams, "bad args"))).toBe(
      "queryFailed",
    );
    // A genuine network failure is still "unreachable".
    expect(mcpReason(new TypeError("fetch failed"))).toBe("unreachable");
  });

  it("fills SEO domain arguments from the schema", () => {
    expect(
      seoArgs(
        { name: "t", properties: { domain: {} }, required: [] },
        { domain: "a.com" },
      ),
    ).toEqual({ domain: "a.com" });
  });
});
