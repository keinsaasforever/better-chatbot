import { describe, expect, it } from "vitest";
import {
  assertServerCanExecuteMcpConfig,
  canExecuteMcpOnServer,
  McpDeviceExecutionRequiredError,
  requiresDeviceExecution,
} from "./execution-plane";

describe("requiresDeviceExecution", () => {
  it("is true for stdio configs", () => {
    expect(
      requiresDeviceExecution({ command: "npx", args: ["-y", "mcp"] }),
    ).toBe(true);
  });

  it("is false for remote configs", () => {
    expect(requiresDeviceExecution({ url: "https://example.com/mcp" })).toBe(
      false,
    );
  });
});

describe("canExecuteMcpOnServer", () => {
  it("allows remote configs on Vercel", () => {
    expect(
      canExecuteMcpOnServer({ url: "https://example.com/mcp" }, true),
    ).toBe(true);
  });

  it("blocks stdio on remote-only runtimes", () => {
    expect(canExecuteMcpOnServer({ command: "npx", args: [] }, true)).toBe(
      false,
    );
  });

  it("allows stdio on local Node runtime", () => {
    expect(canExecuteMcpOnServer({ command: "npx", args: [] }, false)).toBe(
      true,
    );
  });
});

describe("assertServerCanExecuteMcpConfig", () => {
  it("throws for stdio on Vercel", () => {
    expect(() =>
      assertServerCanExecuteMcpConfig({ command: "npx", args: [] }, true),
    ).toThrow(McpDeviceExecutionRequiredError);
  });
});
