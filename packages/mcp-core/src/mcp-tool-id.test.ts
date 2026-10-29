import { describe, expect, it } from "vitest";
import {
  createMCPToolId,
  extractMCPToolId,
  sanitizeFunctionName,
} from "./mcp-tool-id";

describe("sanitizeFunctionName", () => {
  it("should sanitize names with invalid characters", () => {
    expect(sanitizeFunctionName("server@name")).toBe("server_name");
    expect(sanitizeFunctionName("special!chars")).toBe("special_chars");
    expect(sanitizeFunctionName("spaces are bad")).toBe("spaces_are_bad");
  });

  it("should ensure names start with a letter or underscore", () => {
    expect(sanitizeFunctionName("1numberfirst")).toBe("_1numberfirst");
    expect(sanitizeFunctionName("123")).toBe("_123");
    expect(sanitizeFunctionName("_valid")).toBe("_valid");
    expect(sanitizeFunctionName("a_valid")).toBe("a_valid");
  });

  it("should truncate names to 124 characters", () => {
    const longName = "a".repeat(150);
    expect(sanitizeFunctionName(longName).length).toBe(124);
    expect(sanitizeFunctionName(longName)).toBe("a".repeat(124));
  });

  it("should allow dots and dashes", () => {
    expect(sanitizeFunctionName("valid.name")).toBe("valid.name");
    expect(sanitizeFunctionName("valid-name")).toBe("valid-name");
    expect(sanitizeFunctionName("valid.name-with_underscore")).toBe(
      "valid.name-with_underscore",
    );
  });
});

describe("createMCPToolId", () => {
  it("should create a valid tool ID from server and tool names", () => {
    const toolId = createMCPToolId("server", "tool");
    expect(toolId).toBe("server_tool");
  });

  it("should sanitize server and tool names", () => {
    const toolId = createMCPToolId("server@name", "tool!function");
    expect(toolId).toBe("server_name_tool_function");
  });

  it("should ensure the combined name doesn't exceed 124 characters", () => {
    const longServerName = "s".repeat(40);
    const longToolName = "t".repeat(40);
    const toolId = createMCPToolId(longServerName, longToolName);

    expect(toolId.length).toBeLessThanOrEqual(124);
    expect(toolId).toContain("_"); // Should still contain the separator
  });

  it("should handle special characters and spaces", () => {
    const toolId = createMCPToolId("MCP Server #1", "Some Tool Function!");
    expect(toolId).toBe("MCP_Server__1_Some_Tool_Function_");
  });
});

describe("extractMCPToolId", () => {
  it("should extract server name and tool name from a tool ID", () => {
    const { serverName, toolName } = extractMCPToolId("server_tool");
    expect(serverName).toBe("server");
    expect(toolName).toBe("tool");
  });

  it("should handle tool names with underscores", () => {
    const { serverName, toolName } = extractMCPToolId(
      "server_tool_with_underscores",
    );
    expect(serverName).toBe("server");
    expect(toolName).toBe("tool_with_underscores");
  });
});
