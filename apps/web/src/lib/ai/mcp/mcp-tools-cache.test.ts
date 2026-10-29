import type { MCPToolInfo } from "app-types/mcp";
import { describe, expect, it, vi } from "vitest";
import {
  loadMcpToolInfoCached,
  peekMcpToolInfo,
  rememberMcpToolLoadFailure,
} from "./mcp-tools-cache";

const tool = (name: string): MCPToolInfo =>
  ({ name, description: "", inputSchema: {} }) as MCPToolInfo;

// The module memoizes per server id, so every test uses its own.
describe("mcp tool info cache", () => {
  it("misses for a server it has not seen", () => {
    expect(peekMcpToolInfo("unseen", "1")).toBeUndefined();
  });

  it("serves a loaded tool list without running the loader again", async () => {
    const loader = vi.fn(async () => [tool("search")]);

    expect(await loadMcpToolInfoCached("ok", "1", loader)).toEqual([
      tool("search"),
    ]);
    expect(await loadMcpToolInfoCached("ok", "1", loader)).toEqual([
      tool("search"),
    ]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  // Four unreachable servers were charging every chat request the full 8s
  // MCP_INTROSPECT_TIMEOUT, because a rejected loader is not cached and the
  // circuit breaker needs three strikes in a process that is usually cold.
  it("skips a server that just failed instead of probing it again", async () => {
    const loader = vi.fn(async () => [tool("search")]);

    rememberMcpToolLoadFailure("dead", "1");

    expect(peekMcpToolInfo("dead", "1")).toEqual([]);
    expect(await loadMcpToolInfoCached("dead", "1", loader)).toEqual([]);
    expect(loader).not.toHaveBeenCalled();
  });

  it("retries once the server's config changes", async () => {
    const loader = vi.fn(async () => [tool("search")]);

    rememberMcpToolLoadFailure("edited", "1");

    expect(peekMcpToolInfo("edited", "2")).toBeUndefined();
    expect(await loadMcpToolInfoCached("edited", "2", loader)).toEqual([
      tool("search"),
    ]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("lets a later success replace the cached failure", async () => {
    rememberMcpToolLoadFailure("recovered", "1");
    expect(peekMcpToolInfo("recovered", "1")).toEqual([]);

    // A different version is the only way back in while the failure is fresh,
    // which is what a config edit or the TTL expiring produces.
    await loadMcpToolInfoCached("recovered", "2", async () => [tool("search")]);

    expect(peekMcpToolInfo("recovered", "2")).toEqual([tool("search")]);
  });
});
