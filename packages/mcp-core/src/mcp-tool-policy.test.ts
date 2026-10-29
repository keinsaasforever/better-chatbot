import { describe, expect, it } from "vitest";
import {
  assertDesktopMcpToolAllowed,
  filterAllowedDesktopMcpTools,
  isDesktopMcpToolAllowed,
} from "./mcp-tool-policy";

describe("mcp-tool-policy", () => {
  it("allows read-only filesystem tools", () => {
    expect(isDesktopMcpToolAllowed("read_file")).toBe(true);
    expect(() => assertDesktopMcpToolAllowed("read_file")).not.toThrow();
  });

  it("denies write tools", () => {
    expect(isDesktopMcpToolAllowed("write_file")).toBe(false);
    expect(() => assertDesktopMcpToolAllowed("write_file")).toThrow(
      /not allowed/,
    );
  });

  it("filters tool lists", () => {
    const filtered = filterAllowedDesktopMcpTools([
      { name: "read_file" },
      { name: "write_file" },
    ]);
    expect(filtered).toEqual([{ name: "read_file" }]);
  });
});
