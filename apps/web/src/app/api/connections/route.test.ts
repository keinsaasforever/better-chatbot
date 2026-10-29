import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  toolkits: vi.fn(),
  connectedAccountsList: vi.fn(),
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  configured: true,
}));

vi.mock("lib/composio/client", () => ({
  composio: {
    create: vi.fn(async () => ({ toolkits: mocks.toolkits })),
    connectedAccounts: { list: mocks.connectedAccountsList },
  },
}));

vi.mock("lib/composio/config", () => ({
  isComposioConfigured: () => mocks.configured,
}));

vi.mock("lib/cache", () => ({
  serverCache: { get: mocks.cacheGet, set: mocks.cacheSet },
}));

vi.mock("auth/route-guard", () => ({
  withAuth:
    (handler: any) =>
    (req: any, ...rest: any[]) =>
      handler(req, { user: { id: "user_1" } }, ...rest),
}));

import { GET } from "./route";

const request = (url: string) => new Request(url) as any;

const toolkit = (slug: string, connected = true) => ({
  slug,
  name: slug.toUpperCase(),
  logo: `https://logo/${slug}`,
  isNoAuth: false,
  connection: connected
    ? { isActive: true, connectedAccount: { id: `ca_${slug}` } }
    : undefined,
});

const account = (slug: string) => ({
  id: `ca_${slug}`,
  isDisabled: false,
  toolkit: { slug },
});

beforeEach(() => {
  mocks.configured = true;
  vi.clearAllMocks();
  mocks.cacheGet.mockResolvedValue(undefined);
  mocks.cacheSet.mockResolvedValue(undefined);
  mocks.connectedAccountsList.mockResolvedValue({
    items: [],
    nextCursor: null,
  });
});

describe("GET /api/connections?connectedOnly=true", () => {
  it("asks Composio for the connected toolkits instead of walking the catalog", async () => {
    mocks.toolkits.mockResolvedValue({
      items: [toolkit("gmail"), toolkit("slack")],
      nextCursor: null,
    });
    mocks.connectedAccountsList.mockResolvedValue({
      items: [account("gmail"), account("slack")],
      nextCursor: null,
    });

    const res = await GET(
      request("https://x.test/api/connections?connectedOnly=true"),
    );
    const body = await res.json();

    expect(mocks.toolkits).toHaveBeenCalledTimes(1);
    expect(mocks.toolkits.mock.calls[0][0]).toMatchObject({
      isConnected: true,
    });
    expect(body.toolkits.map((t: any) => t.slug).sort()).toEqual([
      "gmail",
      "slack",
    ]);
  });

  it("looks up name and logo for a connected app the listing left out", async () => {
    // The reconcile knows about notion; the toolkit listing does not return
    // it. Without the follow-up lookup it renders as a bare slug, no logo.
    mocks.toolkits
      .mockResolvedValueOnce({ items: [toolkit("gmail")], nextCursor: null })
      .mockResolvedValueOnce({ items: [toolkit("notion")], nextCursor: null });
    mocks.connectedAccountsList.mockResolvedValue({
      items: [account("gmail"), account("notion")],
      nextCursor: null,
    });

    const res = await GET(
      request("https://x.test/api/connections?connectedOnly=true"),
    );
    const body = await res.json();

    expect(mocks.toolkits.mock.calls[1][0]).toMatchObject({
      toolkits: ["notion"],
    });
    const notion = body.toolkits.find((t: any) => t.slug === "notion");
    expect(notion).toMatchObject({
      name: "NOTION",
      logo: "https://logo/notion",
      isConnected: true,
      connectedAccountId: "ca_notion",
    });
  });

  it("ignores toolkits the metadata lookup returns that were not asked for", async () => {
    // If the SDK ever ignored the `toolkits` filter it would hand back page
    // one of the catalog, listing apps this user has not connected.
    mocks.toolkits
      .mockResolvedValueOnce({ items: [], nextCursor: null })
      .mockResolvedValueOnce({
        items: [toolkit("notion"), toolkit("stripe")],
        nextCursor: null,
      });
    mocks.connectedAccountsList.mockResolvedValue({
      items: [account("notion")],
      nextCursor: null,
    });

    const res = await GET(
      request("https://x.test/api/connections?connectedOnly=true"),
    );
    const body = await res.json();

    expect(body.toolkits.map((t: any) => t.slug)).toEqual(["notion"]);
  });

  it("still returns the connected apps when the toolkit listing fails", async () => {
    mocks.toolkits.mockRejectedValue(new Error("composio down"));
    mocks.connectedAccountsList.mockResolvedValue({
      items: [account("gmail")],
      nextCursor: null,
    });

    const res = await GET(
      request("https://x.test/api/connections?connectedOnly=true"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.toolkits).toMatchObject([
      { slug: "gmail", isConnected: true, connectedAccountId: "ca_gmail" },
    ]);
  });

  it("drops anything the reconcile does not confirm as connected", async () => {
    // Defensive: if the SDK ever ignores `isConnected`, the dashboard must not
    // suddenly render the whole catalog as connected apps.
    mocks.toolkits.mockResolvedValue({
      items: [toolkit("gmail"), toolkit("stripe", false)],
      nextCursor: null,
    });

    const res = await GET(
      request("https://x.test/api/connections?connectedOnly=true"),
    );
    const body = await res.json();

    expect(body.toolkits.map((t: any) => t.slug)).toEqual(["gmail"]);
  });
});

describe("GET /api/connections (full list)", () => {
  it("serves the catalog from cache on a second request", async () => {
    mocks.toolkits.mockResolvedValue({
      items: [toolkit("gmail", false)],
      nextCursor: null,
    });

    await GET(request("https://x.test/api/connections"));
    expect(mocks.toolkits).toHaveBeenCalledTimes(1);
    expect(mocks.cacheSet).toHaveBeenCalledOnce();

    const cached = mocks.cacheSet.mock.calls[0][1];
    mocks.cacheGet.mockResolvedValue(cached);
    mocks.toolkits.mockClear();

    const res = await GET(request("https://x.test/api/connections"));
    expect(mocks.toolkits).not.toHaveBeenCalled();
    expect((await res.json()).toolkits).toHaveLength(1);
  });

  it("does not cache a search, whose results are per-query", async () => {
    mocks.toolkits.mockResolvedValue({
      items: [toolkit("gmail", false)],
      nextCursor: null,
    });

    await GET(request("https://x.test/api/connections?search=gmail"));
    expect(mocks.toolkits.mock.calls[0][0]).toMatchObject({ search: "gmail" });
    expect(mocks.cacheSet).not.toHaveBeenCalled();
  });
});

describe("GET /api/connections without a Composio key", () => {
  it("returns an empty list without calling Composio", async () => {
    mocks.configured = false;

    const res = await GET(request("http://localhost/api/connections"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ toolkits: [], nextCursor: null });
    expect(mocks.toolkits).not.toHaveBeenCalled();
    expect(mocks.connectedAccountsList).not.toHaveBeenCalled();
  });
});
