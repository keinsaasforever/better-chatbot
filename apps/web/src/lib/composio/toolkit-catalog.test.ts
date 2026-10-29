import { beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock("lib/cache", () => ({
  serverCache: {
    get: (key: string) => cache.get(key),
    set: (key: string, value: unknown, ttl?: number) =>
      cache.set(key, value, ttl),
  },
}));

import {
  getToolkitCatalog,
  readNextCursor,
  walkToolkits,
} from "./toolkit-catalog";

beforeEach(() => {
  cache.store.clear();
  cache.get.mockReset();
  cache.set.mockReset();
  cache.get.mockImplementation(async (key: string) => cache.store.get(key));
  cache.set.mockImplementation(async (key: string, value: unknown) => {
    cache.store.set(key, value);
  });
});

/** A paged `session.toolkits()` stub over a fixed list of slugs. */
function pagedToolkits(slugs: string[], pageSize = 2) {
  const fn = vi.fn(async (query: any = {}) => {
    const start = query.cursor ? Number(query.cursor) : 0;
    const items = slugs.slice(start, start + pageSize).map((slug) => ({
      slug,
      name: slug.toUpperCase(),
      logo: `https://logo/${slug}`,
      isNoAuth: false,
      connection: { isActive: true, connectedAccount: { id: `ca_${slug}` } },
    }));
    const next = start + pageSize;
    return { items, nextCursor: next < slugs.length ? String(next) : null };
  });
  return fn;
}

describe("readNextCursor", () => {
  it("reads either spelling the SDK might use", () => {
    expect(readNextCursor({ nextCursor: "a" })).toBe("a");
    expect(readNextCursor({ next_cursor: "b" })).toBe("b");
    expect(readNextCursor({ cursor: "c" })).toBe("c");
  });

  it("treats an absent or empty cursor as the end of the list", () => {
    expect(readNextCursor({ nextCursor: null })).toBeUndefined();
    expect(readNextCursor({ nextCursor: "" })).toBeUndefined();
    expect(readNextCursor(undefined)).toBeUndefined();
  });
});

describe("walkToolkits", () => {
  it("follows the cursor across every page", async () => {
    const toolkits = pagedToolkits(["a", "b", "c", "d", "e"]);
    const items = await walkToolkits(toolkits);
    expect(items.map((i) => i.slug)).toEqual(["a", "b", "c", "d", "e"]);
    expect(toolkits).toHaveBeenCalledTimes(3);
  });

  it("stops instead of looping when the cursor stops advancing", async () => {
    // A response that always hands back the same cursor would otherwise spin
    // until the page cap.
    const toolkits = vi.fn(async () => ({
      items: [{ slug: "a", name: "A" }],
      nextCursor: "stuck",
    }));
    const items = await walkToolkits(toolkits);
    expect(toolkits).toHaveBeenCalledTimes(2);
    expect(items).toHaveLength(2);
  });

  it("passes the query through to every page", async () => {
    const toolkits = pagedToolkits(["a", "b", "c"]);
    await walkToolkits(toolkits, { isConnected: true });
    for (const call of toolkits.mock.calls) {
      expect(call[0]).toMatchObject({ isConnected: true });
    }
  });
});

describe("getToolkitCatalog", () => {
  it("never caches per-user connection state", async () => {
    const toolkits = pagedToolkits(["gmail", "slack"]);
    const items = await getToolkitCatalog(toolkits);

    // The stub returns a live `connection` on every item; a cached catalog is
    // shared across users, so it must not survive.
    expect(items.every((item) => !("connection" in item))).toBe(true);
    const cached = cache.store.get("composio:toolkit-catalog:v1") as any[];
    expect(cached.every((item) => item.connection === undefined)).toBe(true);
    expect(items[0]).toMatchObject({
      slug: "gmail",
      name: "GMAIL",
      logo: "https://logo/gmail",
    });
  });

  it("serves a second call from the cache without refetching", async () => {
    const toolkits = pagedToolkits(["gmail", "slack"]);
    await getToolkitCatalog(toolkits);
    const callsAfterFirst = toolkits.mock.calls.length;

    const second = await getToolkitCatalog(toolkits);
    expect(toolkits.mock.calls.length).toBe(callsAfterFirst);
    expect(second.map((i) => i.slug)).toEqual(["gmail", "slack"]);
  });

  it("refetches rather than failing when the cache read throws", async () => {
    cache.get.mockRejectedValueOnce(new Error("redis down"));
    const toolkits = pagedToolkits(["gmail"]);
    const items = await getToolkitCatalog(toolkits);
    expect(items.map((i) => i.slug)).toEqual(["gmail"]);
  });

  it("does not cache an empty catalog", async () => {
    const toolkits = vi.fn(async () => ({ items: [], nextCursor: null }));
    await getToolkitCatalog(toolkits);
    expect(cache.set).not.toHaveBeenCalled();
  });
});
