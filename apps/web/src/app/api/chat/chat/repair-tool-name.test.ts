import { describe, expect, it } from "vitest";
import { repairToolName } from "./repair-tool-name";

// The four Composio meta-tools plus a representative slice of the other
// families, as they are actually bound (see `binding tool count` in the chat
// route's logs).
const BOUND = [
  "COMPOSIO_GET_TOOL_SCHEMAS",
  "COMPOSIO_MANAGE_CONNECTIONS",
  "COMPOSIO_MULTI_EXECUTE_TOOL",
  "COMPOSIO_SEARCH_TOOLS",
  "webSearch",
  "python-execution",
  "requestInput",
  "browser-automation",
  "Notion_search",
];

describe("repairToolName", () => {
  it("returns a bound name unchanged", () => {
    expect(repairToolName(BOUND, "COMPOSIO_SEARCH_TOOLS")).toBe(
      "COMPOSIO_SEARCH_TOOLS",
    );
  });

  // The staging failure: `calls=functions_COMPOSIO_SEARCH_TOOLS results=0`,
  // twice in two minutes on thread 4144f955.
  it("strips the namespace the gateway flattened to an underscore", () => {
    expect(repairToolName(BOUND, "functions_COMPOSIO_SEARCH_TOOLS")).toBe(
      "COMPOSIO_SEARCH_TOOLS",
    );
  });

  it("strips the dotted form and a call index", () => {
    expect(repairToolName(BOUND, "functions.webSearch:0")).toBe("webSearch");
    expect(repairToolName(BOUND, "tools.requestInput")).toBe("requestInput");
    expect(repairToolName(BOUND, "webSearch:12")).toBe("webSearch");
  });

  it("recovers a name the model only got the case wrong on", () => {
    expect(repairToolName(BOUND, "composio_search_tools")).toBe(
      "COMPOSIO_SEARCH_TOOLS",
    );
    expect(repairToolName(BOUND, "functions_websearch")).toBe("webSearch");
  });

  it("gives up rather than guessing", () => {
    // `calls=start`, also from the failing thread. No tool by that name exists.
    expect(repairToolName(BOUND, "start")).toBeNull();
    expect(repairToolName(BOUND, "functions_")).toBeNull();
    expect(repairToolName(BOUND, "")).toBeNull();
    expect(repairToolName([], "COMPOSIO_SEARCH_TOOLS")).toBeNull();
  });

  it("never reaches a tool that is not bound", () => {
    expect(repairToolName(BOUND, "functions_GMAIL_SEND_EMAIL")).toBeNull();
  });

  // MCP binds tools as `${server.name}_${tool.name}`, so a server named
  // "tools" would produce names the stripper would otherwise bite into.
  it("prefers an exact match over stripping a prefix", () => {
    const bound = ["tools_search", "search"];
    expect(repairToolName(bound, "tools_search")).toBe("tools_search");
  });

  it("does not choose between names differing only by case", () => {
    expect(repairToolName(["Search", "search"], "SEARCH")).toBeNull();
  });
});
