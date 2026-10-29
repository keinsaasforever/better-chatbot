import { AppDefaultToolkit, DefaultToolName } from "lib/ai/tools";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { loadAppDefaultTools } = await import("./tool-loading");

const CODE_TOOLS = [
  DefaultToolName.PythonExecution,
  DefaultToolName.E2BSandbox,
  DefaultToolName.JavascriptExecution,
];

const load = (opt?: Parameters<typeof loadAppDefaultTools>[0]) =>
  Object.keys(loadAppDefaultTools(opt));

describe("loadAppDefaultTools", () => {
  it("resolves from the toolkits when there are no mentions", () => {
    const names = load({ allowedAppDefaultToolkit: [AppDefaultToolkit.Code] });
    for (const tool of CODE_TOOLS) expect(names).toContain(tool);
  });

  it("keeps the code tools when only an agent mention is present", () => {
    // Selecting an agent injects a {type:"agent"} mention. That alone used to
    // drop every app default tool, so an agent turn silently lost
    // python-execution and e2b-sandbox while all Composio tools stayed bound.
    const names = load({
      allowedAppDefaultToolkit: [AppDefaultToolkit.Code],
      mentions: [
        { type: "agent", agentId: "a1", name: "Research", icon: undefined },
      ] as never,
    });

    for (const tool of CODE_TOOLS) expect(names).toContain(tool);
  });

  it("pins a mentioned tool and still keeps code execution available", () => {
    const names = load({
      allowedAppDefaultToolkit: [
        AppDefaultToolkit.Code,
        AppDefaultToolkit.WebSearch,
      ],
      mentions: [
        {
          type: "defaultTool",
          name: DefaultToolName.WebSearch,
          label: DefaultToolName.WebSearch,
        },
      ] as never,
    });

    // The pin is honoured...
    expect(names).toContain(DefaultToolName.WebSearch);
    // ...and an agent that pins a table builder can still compute what goes
    // in the table.
    for (const tool of CODE_TOOLS) expect(names).toContain(tool);
  });

  it("does not resurrect code tools the user switched off", () => {
    // The fix must widen availability, never override an explicit opt-out.
    const names = load({
      allowedAppDefaultToolkit: [AppDefaultToolkit.WebSearch],
      mentions: [
        {
          type: "defaultTool",
          name: DefaultToolName.WebSearch,
          label: DefaultToolName.WebSearch,
        },
      ] as never,
    });

    for (const tool of CODE_TOOLS) expect(names).not.toContain(tool);
  });

  describe("headless runs", () => {
    // A scheduled run has no browser. Code tools are declared without an
    // `execute`, so the SDK halts on the call and the run ends with no answer
    // unless server-executing variants are bound instead.
    const loadTools = (headless: boolean) =>
      loadAppDefaultTools({
        allowedAppDefaultToolkit: [AppDefaultToolkit.Code],
        userId: "u1",
        headless,
      });

    it("binds server-executing code tools and drops e2b-sandbox", () => {
      const tools = loadTools(true);

      expect(tools[DefaultToolName.PythonExecution]?.execute).toBeTypeOf(
        "function",
      );
      expect(tools[DefaultToolName.JavascriptExecution]?.execute).toBeTypeOf(
        "function",
      );
      // No panel for the user to open, so it could only stall the run.
      expect(tools).not.toHaveProperty(DefaultToolName.E2BSandbox);
    });

    it("leaves the interactive path client-side", () => {
      const tools = loadTools(false);

      for (const tool of CODE_TOOLS) expect(tools).toHaveProperty(tool);
      expect(tools[DefaultToolName.PythonExecution]?.execute).toBeUndefined();
      expect(
        tools[DefaultToolName.JavascriptExecution]?.execute,
      ).toBeUndefined();
    });

    it("still respects Code being switched off", () => {
      const names = load({
        allowedAppDefaultToolkit: [AppDefaultToolkit.WebSearch],
        userId: "u1",
        headless: true,
      });

      for (const tool of CODE_TOOLS) expect(names).not.toContain(tool);
    });
  });

  it("keeps code tools off for an agent turn when Code is disabled", () => {
    const names = load({
      allowedAppDefaultToolkit: [AppDefaultToolkit.WebSearch],
      mentions: [
        { type: "agent", agentId: "a1", name: "Research", icon: undefined },
      ] as never,
    });

    for (const tool of CODE_TOOLS) expect(names).not.toContain(tool);
    expect(names).toContain(DefaultToolName.WebSearch);
  });
});

describe("create-pdf binding", () => {
  const original = process.env.E2B_EXECUTION_TEMPLATE;
  afterEach(() => {
    if (original === undefined) delete process.env.E2B_EXECUTION_TEMPLATE;
    else process.env.E2B_EXECUTION_TEMPLATE = original;
  });

  const loadDocumentTools = (userId?: string) =>
    loadAppDefaultTools({
      allowedAppDefaultToolkit: [AppDefaultToolkit.Code],
      userId,
    });

  it("drops the tool when the sandbox has no renderer", () => {
    // Offering it against the stock interpreter means every call dies on the
    // WeasyPrint import; the model should reach for python-execution instead.
    process.env.E2B_EXECUTION_TEMPLATE = "code-interpreter-v1";

    expect(loadDocumentTools("u1")).not.toHaveProperty(
      DefaultToolName.CreatePdf,
    );
  });

  it("binds an executable tool when the renderer is available", () => {
    process.env.E2B_EXECUTION_TEMPLATE = "navigator-python-docs";

    const tools = loadDocumentTools("u1");
    expect(tools[DefaultToolName.CreatePdf]?.execute).toBeTypeOf("function");
  });

  it("leaves the placeholder when there is no user to bill", () => {
    // Without a userId there is nothing to bind, so the unbound entry stays
    // and says so rather than rendering as a nameless user.
    process.env.E2B_EXECUTION_TEMPLATE = "navigator-python-docs";

    expect(loadDocumentTools()).toHaveProperty(DefaultToolName.CreatePdf);
  });
});
