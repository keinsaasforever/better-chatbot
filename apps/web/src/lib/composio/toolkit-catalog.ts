import { serverCache } from "lib/cache";

/**
 * One item as `session.toolkits()` hands it back. `connection` is per-user
 * state; everything else is catalog metadata shared by every user.
 */
export type ToolkitListItem = {
  slug: string;
  name: string;
  logo?: string;
  isNoAuth?: boolean;
  connection?: {
    isActive?: boolean;
    connectedAccount?: { id: string };
  };
};

/** The subset of `session.toolkits()` options this module passes through. */
export type ToolkitQuery = {
  limit?: number;
  search?: string;
  cursor?: string;
  toolkits?: string[];
  isConnected?: boolean;
};

/** `session.toolkits` — narrowed to what we call, so tests can pass a stub. */
export type ToolkitsFn = (query?: ToolkitQuery) => Promise<unknown>;

/** Upstream caps a toolkit page at 50; asking for more is silently reduced. */
export const MAX_TOOLKIT_PAGE = 50;

/** Bounds a full walk at 50 × 50 = 2500 toolkits. */
const MAX_TOOLKIT_PAGES = 50;

/**
 * The cursor for the next page of `session.toolkits()`, or undefined at the end.
 *
 * The SDK's paging *parameter* is `cursor` — the same name `connectedAccounts
 * .list` uses. Calls here once passed `nextCursor`, which the SDK ignores, so
 * every request returned page one: the browse drawer never got a "Load more"
 * and the full-list path exhausted after 50 toolkits out of 250+.
 *
 * The response *field* is read tolerantly because the SDK and the REST docs
 * disagree on its name, and reading the wrong one silently truncates the list
 * again.
 */
export function readNextCursor(page: unknown): string | undefined {
  const p = page as Record<string, unknown> | null | undefined;
  const value = p?.nextCursor ?? p?.next_cursor ?? p?.cursor;
  return typeof value === "string" && value ? value : undefined;
}

function readItems(page: unknown): ToolkitListItem[] {
  const items = (page as { items?: unknown })?.items;
  return Array.isArray(items) ? (items as ToolkitListItem[]) : [];
}

/** One page of toolkits, plus the cursor to continue from. */
export async function fetchToolkitPage(
  toolkits: ToolkitsFn,
  query: ToolkitQuery = {},
): Promise<{ items: ToolkitListItem[]; nextCursor?: string }> {
  const page = await toolkits(query);
  return { items: readItems(page), nextCursor: readNextCursor(page) };
}

/**
 * Walk every page for a query. A repeating cursor means the page did not
 * advance — stopping beats looping forever on a response shape we guessed
 * wrong about.
 */
export async function walkToolkits(
  toolkits: ToolkitsFn,
  query: Omit<ToolkitQuery, "cursor"> = {},
): Promise<ToolkitListItem[]> {
  const all: ToolkitListItem[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (let attempt = 0; attempt < MAX_TOOLKIT_PAGES; attempt++) {
    const page = await fetchToolkitPage(toolkits, {
      limit: MAX_TOOLKIT_PAGE,
      ...query,
      ...(cursor ? { cursor } : {}),
    });
    all.push(...page.items);

    if (!page.nextCursor || seenCursors.has(page.nextCursor)) break;
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }

  return all;
}

// Bump the suffix when the picked field set below changes, so a warm instance
// does not serve entries shaped for the previous version.
const CATALOG_CACHE_KEY = "composio:toolkit-catalog:v1";
const CATALOG_TTL_MS = 60 * 60 * 1000;

/**
 * The full toolkit catalog is ~250 entries and takes six sequential round
 * trips to walk, so it is cached under a key shared by every user.
 *
 * That is only safe because the entries are rebuilt field by field here and
 * `connection` — the one per-user field `session.toolkits()` returns — is
 * dropped rather than filtered, so a cached entry cannot carry one user's
 * connection state into another user's response. Connection status comes from
 * the caller's own `connectedAccounts.list` reconcile instead, which the
 * connections route already treats as the authoritative source.
 *
 * Do not widen the picked fields without re-checking that they are global.
 */
export async function getToolkitCatalog(
  toolkits: ToolkitsFn,
): Promise<ToolkitListItem[]> {
  try {
    const cached = await serverCache.get<ToolkitListItem[]>(CATALOG_CACHE_KEY);
    if (cached?.length) return cached;
  } catch (error) {
    // A cache read must never fail the request; fall through and refetch.
    console.error("[composio catalog] cache read failed:", error);
  }

  const items = await walkToolkits(toolkits);
  const metadata: ToolkitListItem[] = items.map((item) => ({
    slug: item.slug,
    name: item.name,
    logo: item.logo,
    isNoAuth: item.isNoAuth,
  }));

  if (metadata.length) {
    try {
      await serverCache.set(CATALOG_CACHE_KEY, metadata, CATALOG_TTL_MS);
    } catch (error) {
      console.error("[composio catalog] cache write failed:", error);
    }
  }

  return metadata;
}
