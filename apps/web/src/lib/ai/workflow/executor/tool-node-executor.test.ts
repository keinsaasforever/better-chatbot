import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createEphemeralMCPClient: vi.fn(),
  callTool: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("lib/ai/mcp/ephemeral-client", () => ({
  createEphemeralMCPClient: (...args: unknown[]) =>
    mocks.createEphemeralMCPClient(...args),
}));
vi.mock("lib/ai/models", () => ({ customModelProvider: {} }));

import type { WorkflowRuntimeState } from "./graph-store";
import { toolNodeExecutor } from "./node-executor";

const node = {
  tool: {
    type: "mcp-tool",
    serverId: "srv-1",
    id: "search",
    description: "search",
  },
} as never;

function state(caller?: WorkflowRuntimeState["caller"]) {
  return { caller } as WorkflowRuntimeState;
}

beforeEach(() => {
  mocks.createEphemeralMCPClient.mockReset();
  mocks.callTool.mockReset();
  mocks.disconnect.mockReset();
  mocks.createEphemeralMCPClient.mockResolvedValue({
    callTool: mocks.callTool,
    disconnect: mocks.disconnect,
  });
});

describe("toolNodeExecutor (mcp-tool)", () => {
  it("calls the MCP server as the workflow caller, scoped to their org", async () => {
    mocks.callTool.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    });

    const result = await toolNodeExecutor({
      node,
      state: state({ userId: "u1", organizationId: "org1" }),
    });

    expect(mocks.createEphemeralMCPClient).toHaveBeenCalledWith("srv-1", "u1", {
      organizationId: "org1",
    });
    expect(mocks.callTool).toHaveBeenCalledWith("search", {});
    expect(mocks.disconnect).toHaveBeenCalled();
    expect(result.output).toEqual({
      tool_result: { content: [{ type: "text", text: "ok" }] },
    });
  });

  it("refuses to run without a caller identity", async () => {
    await expect(toolNodeExecutor({ node, state: state() })).rejects.toThrow(
      /no caller identity/,
    );
    expect(mocks.createEphemeralMCPClient).not.toHaveBeenCalled();
  });

  it("fails when the server is not visible to the caller", async () => {
    mocks.createEphemeralMCPClient.mockResolvedValue(null);
    await expect(
      toolNodeExecutor({ node, state: state({ userId: "u2" }) }),
    ).rejects.toThrow(/not found or disabled/);
  });
});
