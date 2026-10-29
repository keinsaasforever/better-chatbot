import { describe, expect, it, vi } from "vitest";
import {
  assertStdioTransportAllowed,
  buildStreamableHttpTransport,
  resolveTransportKind,
} from "./transport";
import {
  StdioTransportNotSupportedError,
  isMcpSessionNotFound,
  retryMcpSessionOnce,
  shouldFallbackToSse,
} from "./transport-errors";

describe("assertStdioTransportAllowed", () => {
  it("throws when remote-only runtime", () => {
    expect(() => assertStdioTransportAllowed(true)).toThrow(
      StdioTransportNotSupportedError,
    );
  });

  it("allows stdio when not remote-only", () => {
    expect(() => assertStdioTransportAllowed(false)).not.toThrow();
  });
});

describe("resolveTransportKind", () => {
  it("detects stdio config", () => {
    expect(resolveTransportKind({ command: "npx", args: ["-y", "mcp"] })).toBe(
      "stdio",
    );
  });

  it("detects remote config", () => {
    expect(resolveTransportKind({ url: "https://example.com/mcp" })).toBe(
      "remote",
    );
  });
});

describe("buildStreamableHttpTransport", () => {
  it("creates transport for valid remote config", () => {
    const transport = buildStreamableHttpTransport({
      url: "https://example.com/mcp",
    });
    expect(transport).toBeDefined();
  });
});

describe("remote transport error classification", () => {
  it("recognizes a stale MCP session", () => {
    expect(isMcpSessionNotFound(new Error("Session not found"))).toBe(true);
    expect(isMcpSessionNotFound(new Error("Not Found"))).toBe(false);
  });

  it("does not downgrade stale sessions or authentication errors to SSE", () => {
    expect(
      shouldFallbackToSse(
        Object.assign(new Error("Session not found"), { code: 404 }),
      ),
    ).toBe(false);
    expect(
      shouldFallbackToSse(
        Object.assign(new Error("Unauthorized"), { status: 401 }),
      ),
    ).toBe(false);
  });

  it("falls back when Streamable HTTP is unsupported", () => {
    expect(
      shouldFallbackToSse(
        Object.assign(new Error("Method Not Allowed"), { status: 405 }),
      ),
    ).toBe(true);
  });

  it("never downgrades an explicit /mcp Streamable HTTP endpoint to SSE", () => {
    expect(
      shouldFallbackToSse(
        Object.assign(new Error("Method Not Allowed"), { status: 405 }),
        "https://example.com/mcp",
      ),
    ).toBe(false);
  });
});

describe("retryMcpSessionOnce", () => {
  it("resets and retries a stale session exactly once", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("Session not found"))
      .mockResolvedValueOnce("connected");
    const reset = vi.fn(async () => undefined);

    await expect(retryMcpSessionOnce(operation, reset)).resolves.toBe(
      "connected",
    );
    expect(operation).toHaveBeenCalledTimes(2);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("surfaces the second stale-session failure without looping", async () => {
    const operation = vi.fn(async () => {
      throw new Error("Session not found");
    });
    const reset = vi.fn(async () => undefined);

    await expect(retryMcpSessionOnce(operation, reset)).rejects.toThrow(
      "Session not found",
    );
    expect(operation).toHaveBeenCalledTimes(2);
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
