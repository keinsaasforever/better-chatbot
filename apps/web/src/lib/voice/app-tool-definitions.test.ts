import { describe, expect, it } from "vitest";
import { listNavigatorToolSpecs } from "lib/navigator-tools/definitions";
import {
  BROWSER_VOICE_APP_TOOL_DEFINITIONS,
  VOICE_APP_TOOL_DEFINITIONS,
  VOICE_APP_TOOL_NAMES,
  getVoiceAppToolDefinitions,
  isBrowserVoiceAppTool,
  isVoiceAppToolName,
  voiceAppToolToRealtimeFunction,
} from "./app-tool-definitions";

describe("voice app tool definitions", () => {
  it("has unique names", () => {
    expect(new Set(VOICE_APP_TOOL_NAMES).size).toBe(
      VOICE_APP_TOOL_DEFINITIONS.length,
    );
  });

  it("converts every definition to a serializable object schema", () => {
    for (const definition of VOICE_APP_TOOL_DEFINITIONS) {
      const fn = voiceAppToolToRealtimeFunction(definition);
      expect(fn.type).toBe("function");
      expect(fn.name).toBe(definition.name);
      expect(fn.description).toBeTruthy();
      expect(fn.parameters.type).toBe("object");
      expect(fn.parameters.$schema).toBeUndefined();
      expect(typeof fn.parameters.properties).toBe("object");
      expect(Array.isArray(fn.parameters.required)).toBe(true);
      expect(() => JSON.stringify(fn)).not.toThrow();
    }
  });

  it("keeps optional fields out of required", () => {
    const definition = VOICE_APP_TOOL_DEFINITIONS.find(
      (d) => d.name === "send_chat_message",
    )!;
    const fn = voiceAppToolToRealtimeFunction(definition);
    expect(fn.parameters.required).toEqual(["message"]);
    expect(Object.keys(fn.parameters.properties as object)).toEqual(
      expect.arrayContaining(["message", "threadId", "agentId", "projectName"]),
    );
  });

  it("classifies tool names", () => {
    expect(isVoiceAppToolName("list_agents")).toBe(true);
    expect(isVoiceAppToolName("changeBrowserTheme")).toBe(false);
    expect(isVoiceAppToolName("someMcpTool")).toBe(false);
    expect(isBrowserVoiceAppTool("activateAgent")).toBe(true);
    expect(isBrowserVoiceAppTool("list_agents")).toBe(false);
  });

  /**
   * Only the three tools the hook must run in the browser are hand-written;
   * every server tool is the Navigator registry's, so voice and MCP cannot
   * drift apart.
   */
  it("hand-writes only the browser-target tools", () => {
    expect(
      BROWSER_VOICE_APP_TOOL_DEFINITIONS.map((d) => [d.name, d.target]),
    ).toEqual([
      ["activateAgent", "browser"],
      ["browseWeb", "browser"],
      ["checkBrowserRun", "browser"],
    ]);
    const server = VOICE_APP_TOOL_DEFINITIONS.filter(
      (d) => d.target === "server",
    ).map((d) => d.name);
    expect(server).toEqual(
      listNavigatorToolSpecs({ voice: true }).map((d) => d.name),
    );
  });

  /**
   * Hidden from the session (cost guard) but still the app's names: a
   * hallucinated call must be refused by the app executor, not routed to MCP.
   */
  it("keeps voice-hidden registry tools off the list but recognises them", () => {
    const names = VOICE_APP_TOOL_NAMES;
    for (const hidden of [
      "update_agent",
      "create_workflow",
      "cockpit_list_updates",
    ]) {
      expect(names).not.toContain(hidden);
      expect(isVoiceAppToolName(hidden)).toBe(true);
    }
  });

  it("keeps every voice tool description within the per-turn budget", () => {
    for (const definition of VOICE_APP_TOOL_DEFINITIONS) {
      expect(definition.description.length).toBeLessThanOrEqual(200);
    }
    expect(VOICE_APP_TOOL_DEFINITIONS.length).toBeLessThanOrEqual(30);
  });

  it("marks the browser tools that act as not read-only", () => {
    const mutating = BROWSER_VOICE_APP_TOOL_DEFINITIONS.filter(
      (d) => !d.readOnly,
    ).map((d) => d.name);
    expect(mutating.sort()).toEqual([
      "activateAgent",
      // Opens a real browser, spends credits and acts on live websites.
      "browseWeb",
    ]);
  });

  /**
   * Realtime tools are frozen at connect time, so this filter is the only thing
   * standing between an org that has browser automation switched off and a
   * model that believes it can browse. It has to fail closed.
   */
  describe("capability filtering", () => {
    it("withholds the browser tools when the workspace has them off", () => {
      const names = getVoiceAppToolDefinitions({
        browserAutomation: false,
      }).map((d) => d.name);
      expect(names).not.toContain("browseWeb");
      expect(names).not.toContain("checkBrowserRun");
      expect(names).toContain("list_agents");
    });

    it("offers them when it has them on", () => {
      const names = getVoiceAppToolDefinitions({ browserAutomation: true }).map(
        (d) => d.name,
      );
      expect(names).toContain("browseWeb");
      expect(names).toContain("checkBrowserRun");
    });

    it("gates nothing else on the browser capability", () => {
      const off = getVoiceAppToolDefinitions({ browserAutomation: false });
      const on = getVoiceAppToolDefinitions({ browserAutomation: true });
      expect(on.length - off.length).toBe(2);
    });

    /**
     * Name lookups deliberately still see the full list: a call for a tool that
     * was never offered should be recognised and refused clearly, not fall
     * through to the MCP path as an unknown tool.
     */
    it("still recognises a withheld tool by name", () => {
      expect(isVoiceAppToolName("browseWeb")).toBe(true);
      expect(isBrowserVoiceAppTool("browseWeb")).toBe(true);
      expect(isBrowserVoiceAppTool("checkBrowserRun")).toBe(true);
    });
  });
});
