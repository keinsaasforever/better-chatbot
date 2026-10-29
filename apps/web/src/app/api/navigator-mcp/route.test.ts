import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Navigator MCP endpoint over real JSON-RPC: the handler, the SDK and the
 * auth wrapper are the production ones. Only the credential check, the session
 * lookup and the registry's execution are mocked, so this stays DB-free.
 */

const mocks = vi.hoisted(() => ({
  verifyNavigatorApiKey: vi.fn(),
  getSession: vi.fn(),
  runTool: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("lib/navigator-tools/api-keys", () => ({
  verifyNavigatorApiKey: mocks.verifyNavigatorApiKey,
}));

vi.mock("auth/server", () => ({ getSession: mocks.getSession }));

// The real catalog (names, schemas, flags); only `run` is replaced.
vi.mock("lib/navigator-tools/registry", async () => {
  const { NAVIGATOR_TOOL_SPECS } = await import(
    "lib/navigator-tools/definitions"
  );
  return {
    listTools: () =>
      NAVIGATOR_TOOL_SPECS.map((definition) => ({
        ...definition,
        run: vi.fn(),
      })),
    runTool: mocks.runTool,
  };
});

const { POST } = await import("./route");

const KEY = "nav_test_key";
const KEY_ACTOR = {
  userId: "user-1",
  organizationId: "org-key",
  source: "mcp" as const,
};

let nextId = 1;
function rpc(
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return POST(
    new Request("http://localhost/api/navigator-mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    }),
  );
}

/** The JSON-RPC message, whether it came back as JSON or as one SSE event. */
async function messageOf(response: Response) {
  const text = await response.text();
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const data = text
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("");
    return JSON.parse(data);
  }
  return JSON.parse(text);
}

const bearer = { authorization: `Bearer ${KEY}` };

describe("POST /api/navigator-mcp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue(null);
    mocks.verifyNavigatorApiKey.mockImplementation(async (key: string) =>
      key === KEY
        ? { ok: true, actor: KEY_ACTOR }
        : { ok: false, reason: "invalid" },
    );
  });

  it("answers 401 with a bearer challenge when no credential is sent", async () => {
    const response = await rpc("tools/list");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toMatch(/^Bearer /);
    expect(mocks.runTool).not.toHaveBeenCalled();
  });

  it("answers 401 for a key that does not verify", async () => {
    const response = await rpc(
      "tools/list",
      {},
      { authorization: "Bearer nav_wrong" },
    );
    expect(response.status).toBe(401);
  });

  it("answers 429 when the key is over its rate limit", async () => {
    mocks.verifyNavigatorApiKey.mockResolvedValue({
      ok: false,
      reason: "rate_limited",
    });
    const response = await rpc("tools/list", {}, bearer);
    expect(response.status).toBe(429);
    // Verified once per request: a second check would count twice.
    expect(mocks.verifyNavigatorApiKey).toHaveBeenCalledTimes(1);
  });

  it("lists the registry tools for a valid key", async () => {
    const response = await rpc("tools/list", {}, bearer);
    expect(response.status).toBe(200);
    const message = await messageOf(response);
    const names = message.result.tools.map(
      (tool: { name: string }) => tool.name,
    );
    expect(names).toContain("list_agents");
    expect(names).toContain("cockpit_push_update");
    expect(names.length).toBeGreaterThanOrEqual(25);
    const listProjects = message.result.tools.find(
      (tool: { name: string }) => tool.name === "list_projects",
    );
    expect(listProjects.annotations).toEqual(
      expect.objectContaining({ readOnlyHint: true }),
    );
    const sendChat = message.result.tools.find(
      (tool: { name: string }) => tool.name === "send_chat_message",
    );
    expect(sendChat.inputSchema).toEqual(
      expect.objectContaining({ type: "object", required: ["message"] }),
    );
    expect(sendChat.annotations).toEqual(
      expect.objectContaining({ readOnlyHint: false, destructiveHint: false }),
    );
    expect(mocks.verifyNavigatorApiKey).toHaveBeenCalledTimes(1);
  });

  it("runs tools/call with the actor of the key's organization", async () => {
    mocks.runTool.mockResolvedValue({
      ok: true,
      output: { projects: [{ id: "p1", name: "Website" }] },
    });

    const response = await rpc(
      "tools/call",
      { name: "list_projects", arguments: {} },
      bearer,
    );

    expect(response.status).toBe(200);
    expect(mocks.runTool).toHaveBeenCalledWith(KEY_ACTOR, "list_projects", {});
    const message = await messageOf(response);
    expect(message.result.isError).toBeFalsy();
    expect(JSON.parse(message.result.content[0].text)).toEqual({
      projects: [{ id: "p1", name: "Website" }],
    });
  });

  it("reports a tool failure as an MCP error result, not an HTTP error", async () => {
    mocks.runTool.mockResolvedValue({
      ok: false,
      error: { code: "organization_required", message: "No organization" },
    });
    const response = await rpc(
      "tools/call",
      { name: "get_project_status", arguments: { projectName: "Website" } },
      bearer,
    );
    const message = await messageOf(response);
    expect(message.result.isError).toBe(true);
    expect(JSON.parse(message.result.content[0].text)).toEqual({
      code: "organization_required",
      message: "No organization",
    });
  });

  describe("session cookie", () => {
    beforeEach(() => {
      mocks.getSession.mockResolvedValue({
        user: { id: "user-2" },
        session: { activeOrganizationId: "org-session" },
      });
    });

    it("accepts a same-origin browser request as the cockpit", async () => {
      mocks.runTool.mockResolvedValue({ ok: true, output: { agents: [] } });
      const response = await rpc(
        "tools/call",
        { name: "list_agents", arguments: {} },
        { "sec-fetch-site": "same-origin", origin: "http://localhost" },
      );
      expect(response.status).toBe(200);
      expect(mocks.runTool).toHaveBeenCalledWith(
        { userId: "user-2", organizationId: "org-session", source: "cockpit" },
        "list_agents",
        {},
      );
    });

    it("refuses the cookie on a cross-site request", async () => {
      const response = await rpc(
        "tools/call",
        { name: "list_agents", arguments: {} },
        { "sec-fetch-site": "cross-site", origin: "https://evil.example" },
      );
      expect(response.status).toBe(401);
      expect(mocks.getSession).not.toHaveBeenCalled();
      expect(mocks.runTool).not.toHaveBeenCalled();
    });
  });
});
