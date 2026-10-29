import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeVoiceTool } from "./execute-voice-tool";

vi.mock("lib/db/repository", () => ({
  mcpRepository: {
    selectById: vi.fn(),
    selectByServerName: vi.fn(),
    checkAccess: vi.fn(),
  },
}));

vi.mock("lib/ai/mcp/ephemeral-client", () => ({
  createEphemeralMCPClient: vi.fn(),
}));

vi.mock("lib/navigator-tools/registry", () => ({
  runTool: vi.fn(),
}));

vi.mock("./execute-composio-tool", () => ({
  executeComposioVoiceTool: vi.fn(),
}));

const { mcpRepository } = await import("lib/db/repository");
const { createEphemeralMCPClient } = await import(
  "lib/ai/mcp/ephemeral-client"
);
const { runTool } = await import("lib/navigator-tools/registry");
const { executeComposioVoiceTool } = await import("./execute-composio-tool");

describe("executeVoiceTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns browser-only no-op for m5stack default tools", async () => {
    const result = await executeVoiceTool({
      actor: {
        userId: "user-1",
        source: "m5stack",
        deviceId: "device-1",
      },
      toolName: "changeBrowserTheme",
      arguments: { theme: "dark" },
    });

    expect(result.ok).toBe(true);
    expect(result.output).toEqual({
      skipped: true,
      reason: "browser_only",
    });
  });

  it("runs app tools in-process through the registry before any MCP lookup", async () => {
    vi.mocked(runTool).mockResolvedValue({
      ok: true,
      output: { agents: [] },
    });

    const result = await executeVoiceTool({
      actor: { userId: "user-1", organizationId: "org-1", source: "browser" },
      toolName: "list_agents",
      arguments: {},
      callId: "call-1",
    });

    expect(runTool).toHaveBeenCalledWith(
      { userId: "user-1", organizationId: "org-1", source: "voice" },
      "list_agents",
      {},
    );
    expect(mcpRepository.selectById).not.toHaveBeenCalled();
    expect(mcpRepository.selectByServerName).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      toolName: "list_agents",
      callId: "call-1",
      output: { agents: [] },
    });
  });

  it("fails closed to a null organization when the session has none", async () => {
    vi.mocked(runTool).mockResolvedValue({ ok: true, output: {} });

    await executeVoiceTool({
      actor: { userId: "user-1", source: "browser" },
      toolName: "list_projects",
      arguments: {},
    });

    expect(runTool).toHaveBeenCalledWith(
      { userId: "user-1", organizationId: null, source: "voice" },
      "list_projects",
      {},
    );
  });

  it("passes registry errors through with their code", async () => {
    vi.mocked(runTool).mockResolvedValue({
      ok: false,
      error: { code: "organization_required", message: "Keine Organisation" },
    });

    const result = await executeVoiceTool({
      actor: { userId: "user-1", source: "browser" },
      toolName: "get_project_status",
      arguments: {},
      callId: "call-2",
    });

    expect(result).toEqual({
      ok: false,
      toolName: "get_project_status",
      callId: "call-2",
      output: null,
      error: { code: "organization_required", message: "Keine Organisation" },
    });
  });

  /**
   * Browser tools are the hook's to run, and a voice-hidden registry tool was
   * never offered to the session: either name arriving here is refused, never
   * executed and never sent down the MCP path.
   */
  it.each(["activateAgent", "update_agent", "cockpit_list_updates"])(
    "refuses %s on the server",
    async (toolName) => {
      const result = await executeVoiceTool({
        actor: { userId: "user-1", organizationId: "org-1", source: "browser" },
        toolName,
        arguments: {},
      });

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("unknown_tool");
      expect(runTool).not.toHaveBeenCalled();
      expect(mcpRepository.selectByServerName).not.toHaveBeenCalled();
    },
  );

  /**
   * A Composio tool name is neither app-allowlisted nor shaped like an MCP tool
   * id, so without the explicit kind it would fall through to the MCP path and
   * fail with a misleading "MCP server not found".
   */
  it("routes declared composio calls to the composio executor", async () => {
    vi.mocked(executeComposioVoiceTool).mockResolvedValue({
      ok: true,
      toolName: "COMPOSIO_SEARCH_TOOLS",
      output: { results: [] },
    });

    const result = await executeVoiceTool({
      actor: { userId: "user-1", organizationId: "org-1", source: "browser" },
      toolName: "COMPOSIO_SEARCH_TOOLS",
      kind: "composio",
      arguments: { query: "gmail" },
      callId: "call-9",
    });

    expect(executeComposioVoiceTool).toHaveBeenCalledWith({
      toolName: "COMPOSIO_SEARCH_TOOLS",
      args: { query: "gmail" },
      actor: { userId: "user-1", organizationId: "org-1", source: "browser" },
      callId: "call-9",
    });
    expect(mcpRepository.selectByServerName).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("rejects unknown MCP servers", async () => {
    vi.mocked(mcpRepository.selectByServerName).mockResolvedValue(null);

    const result = await executeVoiceTool({
      actor: {
        userId: "user-1",
        source: "browser",
      },
      toolName: "missing_server_createIssue",
      arguments: {},
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("not_found");
  });

  it("enforces MCP access checks", async () => {
    vi.mocked(mcpRepository.selectByServerName).mockResolvedValue({
      id: "server-1",
      name: "linear",
      enabled: true,
    } as any);
    vi.mocked(mcpRepository.checkAccess).mockResolvedValue(false);

    const result = await executeVoiceTool({
      actor: {
        userId: "user-1",
        source: "browser",
      },
      toolName: "linear_createIssue",
      arguments: {},
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("forbidden");
  });

  it("executes the mapped original tool on the mapped server id", async () => {
    const callTool = vi.fn().mockResolvedValue({ deals: [] });
    const disconnect = vi.fn();
    vi.mocked(mcpRepository.selectById).mockResolvedValue({
      id: "server-1",
      name: "Twenty",
      enabled: true,
    } as any);
    vi.mocked(mcpRepository.checkAccess).mockResolvedValue(true);
    vi.mocked(createEphemeralMCPClient).mockResolvedValue({
      callTool,
      disconnect,
    } as any);

    const result = await executeVoiceTool({
      actor: { userId: "user-1", source: "browser" },
      toolName: "Twenty_find_deals",
      mcpServerId: "server-1",
      mcpToolName: "find deals",
      arguments: { limit: 10 },
    });

    expect(mcpRepository.selectById).toHaveBeenCalledWith("server-1");
    expect(mcpRepository.selectByServerName).not.toHaveBeenCalled();
    expect(callTool).toHaveBeenCalledWith("find deals", { limit: 10 });
    expect(result.ok).toBe(true);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("disconnects ephemeral MCP clients after success and failure", async () => {
    const disconnect = vi.fn();
    vi.mocked(mcpRepository.selectByServerName).mockResolvedValue({
      id: "server-1",
      name: "linear",
      enabled: true,
    } as any);
    vi.mocked(mcpRepository.checkAccess).mockResolvedValue(true);
    vi.mocked(createEphemeralMCPClient).mockResolvedValue({
      callTool: vi.fn().mockResolvedValue({ ok: true }),
      disconnect,
    } as any);

    const success = await executeVoiceTool({
      actor: {
        userId: "user-1",
        source: "browser",
      },
      toolName: "linear_createIssue",
      arguments: { title: "Test" },
    });

    expect(success.ok).toBe(true);
    expect(disconnect).toHaveBeenCalledTimes(1);

    disconnect.mockClear();
    vi.mocked(createEphemeralMCPClient).mockResolvedValue({
      callTool: vi.fn().mockRejectedValue(new Error("boom")),
      disconnect,
    } as any);

    const failure = await executeVoiceTool({
      actor: {
        userId: "user-1",
        source: "browser",
      },
      toolName: "linear_createIssue",
      arguments: { title: "Test" },
    });

    expect(failure.ok).toBe(false);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
