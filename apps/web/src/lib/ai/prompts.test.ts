import { describe, expect, it } from "vitest";
import { getNavigatorToolSpec } from "lib/navigator-tools/definitions";
import { getVoiceAppToolDefinitions } from "lib/voice/app-tool-definitions";
import {
  COMPOSIO_FALLBACK_SYSTEM_PROMPT,
  buildCockpitGreetingPrompt,
  buildCockpitOversightPrompt,
  buildHitlSystemPrompt,
  buildSpeechSystemPrompt,
  buildUserSystemPrompt,
  buildVoiceAppControlPrompt,
} from "./prompts";

describe("buildUserSystemPrompt tool usage", () => {
  const prompt = buildUserSystemPrompt();

  // A user asking "Suche nach Bars in Winnemark" got an answer from model
  // memory instead of a web search. The tool was bound and offered; the prompt
  // simply never said when to look things up.
  it("tells the model to search for current or local facts", () => {
    expect(prompt).toMatch(/search the web/i);
    expect(prompt).toMatch(/current, local, or checkable facts/i);
  });

  it("covers explicit lookup requests in both product languages", () => {
    for (const verb of [
      "search",
      "find",
      "research",
      "suche",
      "recherchiere",
    ]) {
      expect(prompt).toContain(verb);
    }
  });

  it("forbids inventing local recommendations from memory", () => {
    expect(prompt).toMatch(/never invent local recommendations/i);
  });

  // Saying *that* the model should search left open *with which tool*. Composio
  // tools arrive from the Tool Router with descriptions we neither see nor
  // edit, exactly as the code sandbox once outranked our own e2b tools.
  it("names the app's own search tools", () => {
    expect(prompt).toContain("webSearch");
    expect(prompt).toContain("webContent");
  });

  it("keeps a connected third-party app out of general web search", () => {
    expect(prompt).toMatch(
      /web search is your own capability, not an integration/i,
    );
    expect(prompt).toMatch(
      /third-party app only when the user names it, or when the answer lives in that app's own data/i,
    );
  });

  // Guard against the opposite failure: a rule broad enough to make every
  // question trigger a search.
  it("still allows answering general knowledge without searching", () => {
    expect(prompt).toMatch(/does not depend on live facts, answer directly/i);
  });

  // MCP tools arrive named `ServerName_toolName`; without this the model has
  // no way to recognize the family, let alone rank it.
  it("explains how MCP server tools are named", () => {
    expect(prompt).toMatch(/ServerName_toolName/);
    expect(prompt).toMatch(/MCP servers the user connected/i);
  });
});

describe("COMPOSIO_FALLBACK_SYSTEM_PROMPT tool selection order", () => {
  const prompt = COMPOSIO_FALLBACK_SYSTEM_PROMPT;

  // The Tool Router's meta-tool descriptions are fetched from Composio's
  // network and outrank nothing by themselves — this block is the only
  // ranking between built-ins, MCP servers, and the router.
  it("ranks the Composio router last, behind built-ins and MCP", () => {
    const builtIns = prompt.indexOf("Built-in app tools");
    const mcp = prompt.indexOf("MCP server tools");
    const composio = prompt.indexOf("LAST-RESORT");
    expect(builtIns).toBeGreaterThan(-1);
    expect(mcp).toBeGreaterThan(builtIns);
    expect(composio).toBeGreaterThan(mcp);
  });

  // Gmail (and others) can be reachable through a user's MCP server AND
  // through Composio; without a tie-break the model picks arbitrarily.
  it("breaks same-app ties in favor of the MCP server", () => {
    expect(prompt).toMatch(/MCP server AND through\s+Composio/i);
    expect(prompt).toMatch(/use the MCP server tool/i);
  });

  it("requires schema discovery before executing a discovered tool", () => {
    expect(prompt).toContain("COMPOSIO_SEARCH_TOOLS");
    expect(prompt).toContain("COMPOSIO_GET_TOOL_SCHEMAS");
    expect(prompt).toMatch(/never guess arguments/i);
  });

  // Preset agents (e.g. the research agent's Parallel-first routing) must be
  // able to override the general order without contradicting it.
  it("lets a selected agent's instructions override the order", () => {
    expect(prompt).toMatch(/agent's instructions may override/i);
  });
});

describe("buildHitlSystemPrompt approval scope", () => {
  const prompt = buildHitlSystemPrompt();

  // Plan approval used to be mandated for ANY multi-tool orchestration and
  // ANY API mutation, which contradicted the tool_usage chaining rule and
  // double-gated actions that already carry needsApproval.
  it("reserves askForPlanApproval for long and complex tasks", () => {
    expect(prompt).toMatch(/LONG AND COMPLEX TASKS ONLY/);
    expect(prompt).toMatch(/read-only chains never need plan approval/i);
  });

  it("does not blanket-gate every API mutation", () => {
    expect(prompt).not.toMatch(/any api mutation/i);
    expect(prompt).toMatch(/never stack both gates/i);
  });

  it("keeps the mandatory two-step email flow", () => {
    expect(prompt).toContain("proposeEmail");
    expect(prompt).toMatch(/must call an email tool to actually deliver it/i);
  });
});

describe("voice app-control prompt", () => {
  const prompt = (browserAutomation = false) =>
    buildVoiceAppControlPrompt({
      agents: [{ id: "agent-1", name: "Sales" }],
      skills: ["Angebot schreiben"],
      browserAutomation,
    });

  /**
   * Generated from the registry the session is given, so the prompt can only
   * describe tools that exist — the hand-written bullets drifted.
   */
  it("lists every voice tool with its registry description and mode", () => {
    const text = prompt();
    for (const tool of getVoiceAppToolDefinitions({
      browserAutomation: false,
    })) {
      expect(text).toContain(
        `- ${tool.name} (${tool.readOnly ? "read-only" : "confirm first"}): ${tool.description}`,
      );
    }
    // Hidden from voice, so never described to it.
    expect(text).not.toContain("- update_agent");
    expect(text).not.toContain("- cockpit_list_updates");
    // The pre-registry camelCase names are gone for good.
    expect(text).not.toMatch(/\b(askAgent|sendChatMessage|listAgents)\b/);
  });

  it("only describes the browser tools when the session has them", () => {
    expect(prompt(false)).not.toContain("browseWeb");
    expect(prompt(true)).toContain("- browseWeb (confirm first)");
  });
});

describe("cockpit oversight prompt", () => {
  it("matches the snapshot", () => {
    expect(buildCockpitOversightPrompt()).toMatchSnapshot();
  });

  it("names only tools the registry actually has", () => {
    const names = buildCockpitOversightPrompt().match(
      /(?<![</])\bcockpit_[a-z_]+/g,
    );
    expect(names?.length).toBeGreaterThan(0);
    for (const name of names ?? []) {
      expect(getNavigatorToolSpec(name)).toBeDefined();
    }
  });
});

describe("cockpit greeting", () => {
  it("greets by first name", () => {
    expect(buildCockpitGreetingPrompt({ name: "Paul Klein" })).toContain(
      'Say exactly "Hi Paul Sir."',
    );
  });

  it("prefers the display name the user chose", () => {
    expect(
      buildCockpitGreetingPrompt({ name: "Paul Klein" }, { displayName: "PK" }),
    ).toContain('"Hi PK Sir."');
  });

  it("still greets without a name, and keeps quotes out of the line", () => {
    expect(buildCockpitGreetingPrompt({ name: "  " })).toContain('"Hi Sir."');
    expect(buildCockpitGreetingPrompt({ name: 'Paul"' })).toContain(
      '"Hi Paul Sir."',
    );
  });
});

describe("speech prompt language and length rules", () => {
  it("answers in German by default and keeps replies short", () => {
    const text = buildSpeechSystemPrompt({
      id: "u1",
      name: "Paul",
      email: "p@example.com",
    } as never);
    expect(text).toContain("answer in German by default");
    expect(text).not.toContain("mirror the user turn by turn");
    expect(text).toContain("Never switch language because audio was unclear");
    expect(text).toContain("one to three short");
    expect(text).toContain("rund zwölftausend Euro");
    expect(text).toContain("(Europe/Berlin)");
  });

  // One default language per session, never two: contradicting rules are what
  // made answers flip between German and English.
  it("answers in English by default for an English session", () => {
    const text = buildSpeechSystemPrompt(
      { id: "u1", name: "Paul", email: "p@example.com" } as never,
      undefined,
      undefined,
      { language: "en" },
    );
    expect(text).toContain("answer in English by default");
    expect(text).not.toContain("answer in German by default");
  });
});
