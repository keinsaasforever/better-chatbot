import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("logger", () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const composio = vi.hoisted(() => ({
  toolkits: vi.fn(),
  tools: vi.fn(),
  configured: true,
}));

vi.mock("lib/composio/config", () => ({
  isComposioConfigured: () => composio.configured,
}));

vi.mock("lib/composio/client", () => ({
  composio: {
    create: async () => ({
      toolkits: (...args: unknown[]) => composio.toolkits(...args),
      tools: (...args: unknown[]) => composio.tools(...args),
    }),
  },
}));

const { loadComposioTools, COMPOSIO_FALLBACK_DESCRIPTION_PREFIX } =
  await import("./tool-loading");

// The module-level memo is keyed by user id and persists across tests, so every
// case needs its own id or it reads the previous case's answer.
let seq = 0;
const freshUser = () => `user-${++seq}`;

const ROUTER_DESCRIPTION = "Search for tools to accomplish any task.";
// What loadComposioTools hands back for the mock above: the Tool Router's own
// wording survives, demoted behind the fallback prefix.
const demotedSearchTool = {
  COMPOSIO_SEARCH_TOOLS: {
    description: `${COMPOSIO_FALLBACK_DESCRIPTION_PREFIX}${ROUTER_DESCRIPTION}`,
  },
};

beforeEach(() => {
  composio.configured = true;
  composio.toolkits.mockReset();
  composio.tools.mockReset().mockResolvedValue({
    COMPOSIO_SEARCH_TOOLS: { description: ROUTER_DESCRIPTION },
  });
});

describe("loadComposioTools connection gate", () => {
  it("does not call Composio at all on an instance without a key", async () => {
    composio.configured = false;

    expect(await loadComposioTools(freshUser())).toEqual({});
    expect(composio.toolkits).not.toHaveBeenCalled();
  });

  // The Tool Router hands back the same four meta-tools whether or not anything
  // is connected, so their schemas were in every prompt of every user.
  it("binds nothing when the user has no connected integration", async () => {
    composio.toolkits.mockResolvedValue({ items: [] });

    expect(await loadComposioTools(freshUser())).toEqual({});
    expect(composio.tools).not.toHaveBeenCalled();
  });

  it("asks the server to filter, rather than enumerating accounts", async () => {
    composio.toolkits.mockResolvedValue({ items: [] });
    await loadComposioTools(freshUser());

    expect(composio.toolkits).toHaveBeenCalledWith({
      limit: 1,
      isConnected: true,
    });
  });

  it("binds the tools once something is connected", async () => {
    composio.toolkits.mockResolvedValue({ items: [{ slug: "gmail" }] });

    expect(await loadComposioTools(freshUser())).toEqual(demotedSearchTool);
  });

  // A wrongly-withheld tool is a broken feature; a wrongly-loaded one costs a
  // few tokens. The repo already documents that these flags lag behind.
  it("fails open when the connection check throws", async () => {
    composio.toolkits.mockRejectedValue(new Error("composio unreachable"));

    expect(await loadComposioTools(freshUser())).toEqual(demotedSearchTool);
  });

  // Only an empty array is evidence of zero connections. A null or reshaped
  // response is doubt, and doubt loads the tools.
  it("treats a malformed answer as doubt, not as zero connections", async () => {
    composio.toolkits.mockResolvedValue(null);

    expect(await loadComposioTools(freshUser())).toEqual(demotedSearchTool);
  });
});

// The Tool Router's descriptions arrive over the network worded broadly enough
// to outcompete first-party tools; the load path stamps the fallback ranking
// into the text the model actually reads.
describe("loadComposioTools fallback demotion", () => {
  beforeEach(() => {
    composio.toolkits.mockResolvedValue({ items: [{ slug: "gmail" }] });
  });

  it("prefixes every tool description with the last-resort framing", async () => {
    composio.tools.mockResolvedValue({
      COMPOSIO_SEARCH_TOOLS: { description: ROUTER_DESCRIPTION },
      COMPOSIO_MULTI_EXECUTE: { description: "Execute several tools." },
    });

    const tools = (await loadComposioTools(freshUser())) as Record<
      string,
      { description?: string }
    >;
    for (const tool of Object.values(tools)) {
      expect(
        tool.description?.startsWith(COMPOSIO_FALLBACK_DESCRIPTION_PREFIX),
      ).toBe(true);
    }
    expect(tools.COMPOSIO_SEARCH_TOOLS.description).toBe(
      `${COMPOSIO_FALLBACK_DESCRIPTION_PREFIX}${ROUTER_DESCRIPTION}`,
    );
  });

  it("still prefixes a tool that ships without a description", async () => {
    composio.tools.mockResolvedValue({ COMPOSIO_SEARCH_TOOLS: {} });

    const tools = (await loadComposioTools(freshUser())) as Record<
      string,
      { description?: string }
    >;
    expect(tools.COMPOSIO_SEARCH_TOOLS.description).toBe(
      COMPOSIO_FALLBACK_DESCRIPTION_PREFIX,
    );
  });
});
