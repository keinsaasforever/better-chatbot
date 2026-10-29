import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/app/api/chat/shared.chat", () => ({
  loadComposioTools: vi.fn(),
}));

vi.mock("@/lib/gate", () => ({
  requireBillingContext: vi.fn(),
  trackUsage: vi.fn(),
}));

const { loadComposioTools } = await import("@/app/api/chat/shared.chat");
const { requireBillingContext, trackUsage } = await import("@/lib/gate");
const { executeComposioVoiceTool } = await import("./execute-composio-tool");

const ACTOR = {
  userId: "user-1",
  organizationId: "org-1",
  source: "browser" as const,
};

/** Let the fire-and-forget metering promise settle before asserting on it. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireBillingContext).mockResolvedValue({
    customerId: "cus_1",
    userId: "user-1",
    entityId: "member_1",
    customerData: { email: "a@b.c", name: "A" },
  });
});

describe("executeComposioVoiceTool", () => {
  it("executes the named tool and counts the call", async () => {
    const execute = vi.fn().mockResolvedValue({ results: ["GMAIL_SEND"] });
    vi.mocked(loadComposioTools).mockResolvedValue({
      COMPOSIO_SEARCH_TOOLS: { execute },
    } as never);

    const result = await executeComposioVoiceTool({
      toolName: "COMPOSIO_SEARCH_TOOLS",
      args: { query: "gmail" },
      actor: ACTOR,
      callId: "call-1",
    });

    expect(result).toEqual({
      ok: true,
      toolName: "COMPOSIO_SEARCH_TOOLS",
      callId: "call-1",
      output: { results: ["GMAIL_SEND"] },
    });
    expect(execute).toHaveBeenCalledWith(
      { query: "gmail" },
      expect.objectContaining({ toolCallId: "call-1" }),
    );

    await flush();
    expect(trackUsage).toHaveBeenCalledWith({
      kind: "toolCall",
      customerId: "cus_1",
      entityId: "member_1",
      toolCallId: "call-1",
      toolName: "COMPOSIO_SEARCH_TOOLS",
    });
  });

  it("reports a tool the router no longer offers instead of throwing", async () => {
    vi.mocked(loadComposioTools).mockResolvedValue({} as never);

    const result = await executeComposioVoiceTool({
      toolName: "COMPOSIO_EXECUTE_TOOL",
      args: {},
      actor: ACTOR,
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("unavailable");
    expect(trackUsage).not.toHaveBeenCalled();
  });

  /** Never surface the provider's message: it can carry account detail. */
  it("returns a generic failure when the tool throws", async () => {
    vi.mocked(loadComposioTools).mockResolvedValue({
      COMPOSIO_EXECUTE_TOOL: {
        execute: vi.fn().mockRejectedValue(new Error("connection cus_x@x.io")),
      },
    } as never);

    const result = await executeComposioVoiceTool({
      toolName: "COMPOSIO_EXECUTE_TOOL",
      args: {},
      actor: ACTOR,
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("tool_execution_failed");
    expect(result.error?.message).not.toContain("cus_x@x.io");
  });

  it("still runs the tool when billing cannot be resolved", async () => {
    // Metering must never be the reason a spoken tool call fails.
    vi.mocked(requireBillingContext).mockRejectedValue(new Error("no session"));
    vi.mocked(loadComposioTools).mockResolvedValue({
      COMPOSIO_EXECUTE_TOOL: { execute: vi.fn().mockResolvedValue("done") },
    } as never);

    const result = await executeComposioVoiceTool({
      toolName: "COMPOSIO_EXECUTE_TOOL",
      args: {},
      actor: ACTOR,
    });

    expect(result.ok).toBe(true);
    await flush();
    expect(trackUsage).not.toHaveBeenCalled();
  });

  /**
   * Every function output stays in the realtime conversation and is re-sent on
   * every following turn, so an unbounded schema dump would be paid for over
   * and over.
   */
  it("truncates outputs too large for a realtime conversation", async () => {
    vi.mocked(loadComposioTools).mockResolvedValue({
      COMPOSIO_GET_TOOL_SCHEMAS: {
        execute: vi.fn().mockResolvedValue({ blob: "x".repeat(20_000) }),
      },
    } as never);

    const result = await executeComposioVoiceTool({
      toolName: "COMPOSIO_GET_TOOL_SCHEMAS",
      args: {},
      actor: ACTOR,
    });

    expect(result.ok).toBe(true);
    expect(result.output).toEqual(
      expect.objectContaining({ truncated: true, note: expect.any(String) }),
    );
    expect(JSON.stringify(result.output).length).toBeLessThan(13_000);
  });
});
