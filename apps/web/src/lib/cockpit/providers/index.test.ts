import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("lib/cache", () => ({
  serverCache: { get: async () => undefined, set: async () => {} },
}));
const log = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));
vi.mock("logger", () => ({ default: log }));
vi.mock("lib/ai/mcp/ephemeral-client", () => ({
  createEphemeralMCPClient: vi.fn(),
}));

const { PROVIDERS, fetchProvider, probeProvider } = await import("./index");

afterEach(() => {
  vi.restoreAllMocks();
  log.warn.mockClear();
  log.error.mockClear();
});

describe("provider instrumentation", () => {
  it("logs a failed probe with its reason and returns it unchanged", async () => {
    vi.spyOn(PROVIDERS.stripe, "probe").mockResolvedValue({
      ok: false,
      reason: "http|404",
    });
    expect(await probeProvider("stripe", {})).toEqual({
      ok: false,
      reason: "http|404",
    });
    expect(log.warn).toHaveBeenCalledWith("[cockpit] probe failed", {
      "cockpit.provider": "stripe",
      "cockpit.reason": "http|404",
    });
  });

  it("turns a throwing provider into the fallback and logs only the error name", async () => {
    vi.spyOn(PROVIDERS.vercel, "fetch").mockRejectedValue(
      new TypeError("body echoed: sk_live_secret"),
    );
    expect(await fetchProvider("vercel", {})).toEqual({
      status: "inop",
      reason: "timeout",
    });
    expect(log.error).toHaveBeenCalledWith("[cockpit] provider threw", {
      "cockpit.provider": "vercel",
      "cockpit.op": "fetch",
      "exception.type": "TypeError",
    });
    expect(JSON.stringify(log.error.mock.calls)).not.toContain("sk_live");
    // Feed refreshes log on state change in feeds.ts, not here.
    expect(log.warn).not.toHaveBeenCalled();
  });
});
