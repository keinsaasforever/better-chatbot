import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Metering goes through the billing gate, not the provider — the community
// edition swaps the gate out and has no billing provider at all.
const trackUsage = vi.fn();
vi.mock("lib/gate", () => ({ trackUsage }));

vi.mock("logger", () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { meterToolCalls } from "./tool-loading";

/** Let the fire-and-forget tracking promise settle before asserting on it. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  trackUsage.mockReset();
  trackUsage.mockResolvedValue(undefined);
});

describe("meterToolCalls", () => {
  it("counts one call per invocation and passes the result through", async () => {
    const execute = vi.fn().mockResolvedValue("tool result");
    const tools = { GMAIL_SEND: { execute } } as any;

    const metered = meterToolCalls(tools, {
      customerId: "cus_1",
      entityId: "user_1",
    });
    const result = await metered.GMAIL_SEND.execute!(
      { to: "a@b.c" } as any,
      {
        toolCallId: "call_1",
      } as any,
    );

    expect(result).toBe("tool result");
    expect(execute).toHaveBeenCalledTimes(1);

    await flush();
    expect(trackUsage).toHaveBeenCalledWith({
      kind: "toolCall",
      customerId: "cus_1",
      entityId: "user_1",
      toolCallId: "call_1",
      toolName: "GMAIL_SEND",
    });
  });

  it("still runs the tool when tracking blows up", async () => {
    // Metering must never be the reason a tool call fails.
    trackUsage.mockRejectedValue(new Error("autumn down"));
    const execute = vi.fn().mockResolvedValue("ok");
    const tools = { SLACK_POST: { execute } } as any;

    const metered = meterToolCalls(tools, { customerId: "cus_1" });

    await expect(
      metered.SLACK_POST.execute!({} as any, { toolCallId: "call_2" } as any),
    ).resolves.toBe("ok");
    await flush();
  });

  it("does not wait for tracking before running the tool", async () => {
    // A tool call must not pay for a billing round trip.
    let settleTracking: () => void = () => {};
    trackUsage.mockReturnValue(
      new Promise<void>((resolve) => {
        settleTracking = resolve;
      }),
    );
    const execute = vi.fn().mockResolvedValue("fast");
    const tools = { NOTION_CREATE: { execute } } as any;

    const metered = meterToolCalls(tools, { customerId: "cus_1" });
    await expect(
      metered.NOTION_CREATE.execute!(
        {} as any,
        {
          toolCallId: "call_3",
        } as any,
      ),
    ).resolves.toBe("fast");

    settleTracking();
  });

  it("leaves tools without an execute function untouched", async () => {
    const tools = { MANUAL: { description: "needs confirmation" } } as any;

    const metered = meterToolCalls(tools, { customerId: "cus_1" });

    expect(metered.MANUAL).toBe(tools.MANUAL);
    expect(trackUsage).not.toHaveBeenCalled();
  });

  it("returns the record unchanged when there is no billing customer", () => {
    const tools = { GMAIL_SEND: { execute: vi.fn() } } as any;

    expect(meterToolCalls(tools, {})).toBe(tools);
  });

  it("does not mutate the cached tool objects", async () => {
    // The Composio loader caches its record per user; wrapping in place would
    // double-count on the next cache hit.
    const original = { execute: vi.fn().mockResolvedValue("x") };
    const tools = { GMAIL_SEND: original } as any;

    const metered = meterToolCalls(tools, { customerId: "cus_1" });

    expect(metered.GMAIL_SEND).not.toBe(original);
    expect(original.execute).toBe(tools.GMAIL_SEND.execute);
  });
});
