import { composio } from "lib/composio/client";
import { isComposioConfigured } from "lib/composio/config";
import {
  MAX_TOOLKIT_PAGE,
  fetchToolkitPage,
  getToolkitCatalog,
  walkToolkits,
  type ToolkitListItem,
  type ToolkitsFn,
} from "lib/composio/toolkit-catalog";
import { mapToolkitsWithAccounts } from "lib/composio/toolkit-connections";
import { withAuth } from "auth/route-guard";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Toolkit connection flags from `session.toolkits()` lag behind (or miss)
// accounts created through other auth flows, which made connected apps
// disappear from the list. Reconcile against the authoritative
// `connectedAccounts.list` — the same source the project-attach route uses.
async function listActiveAccountIdsByToolkit(userId: string) {
  const map = new Map<string, string>();
  let cursor: string | undefined;
  do {
    const page = await composio.connectedAccounts.list({
      userIds: [userId],
      statuses: ["ACTIVE"],
      // Default is PRIVATE-only; include org/shared accounts (e.g. Slack via
      // a shared auth config) so they don't vanish from the connected list.
      accountType: "ALL",
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    for (const item of page?.items ?? []) {
      if (item?.isDisabled) continue;
      const slug = item?.toolkit?.slug?.toLowerCase();
      // Items arrive newest-first; keep the first id we see per toolkit.
      if (slug && !map.has(slug)) map.set(slug, item.id);
    }
    cursor = page?.nextCursor ?? undefined;
  } while (cursor);
  // Deliberate observability while "connected apps missing" reports are open:
  // shows in Vercel logs how many accounts the reconcile actually sees.
  console.info(
    `[connections GET] reconcile: ${map.size} toolkit(s) with active accounts`,
    [...map.keys()].join(", ") || "(none)",
  );
  return map;
}

/**
 * Names and logos for connected toolkits the `isConnected` listing did not
 * return. Without this they fall back to a slug-derived title and no logo.
 * One extra call, and only when the two sources actually disagree.
 */
async function fetchToolkitsBySlug(
  toolkits: ToolkitsFn,
  slugs: string[],
): Promise<ToolkitListItem[]> {
  if (slugs.length === 0) return [];
  const wanted = new Set(slugs.slice(0, MAX_TOOLKIT_PAGE));
  try {
    const page = await fetchToolkitPage(toolkits, {
      toolkits: [...wanted],
      limit: MAX_TOOLKIT_PAGE,
    });
    // Keep only what was asked for: an SDK that ignored the `toolkits` filter
    // would otherwise hand back page one of the catalog, which would both
    // duplicate entries and list apps this user has not connected.
    return page.items.filter((item) =>
      wanted.has(String(item.slug).toLowerCase()),
    );
  } catch (error: any) {
    // Cosmetic enrichment only — the mapper still synthesises an entry from
    // the slug, so a failure here must not take the connected list down.
    console.error(
      "[connections GET] toolkit metadata lookup failed:",
      error?.message ?? error,
    );
    return [];
  }
}

// GET: List toolkits with connection status, priority-sorted
// ?connectedOnly=true → only the user's connected toolkits (no catalog fetch)
// ?paginate=true      → single page; honours ?limit= and ?nextCursor=
// (default)           → legacy full-list mode for existing callers
export const GET = withAuth(async (req, session) => {
  // No Composio key on this instance: there is nothing to list or connect.
  if (!isComposioConfigured()) {
    return NextResponse.json({ toolkits: [], nextCursor: null });
  }
  try {
    const { searchParams } = new URL(req.url);
    // Composio rejects search queries under 3 characters (400). Treat short
    // queries as "no search" so typing in the dialog never breaks the list.
    const rawSearch = searchParams.get("search")?.trim();
    const search = rawSearch && rawSearch.length >= 3 ? rawSearch : undefined;
    const connectedOnly = searchParams.get("connectedOnly") === "true";
    const paginate = searchParams.get("paginate") === "true";
    const cursorParam = searchParams.get("nextCursor") ?? undefined;
    // The NaN fallback used to be 60, a value the finite branch would itself
    // have clamped away.
    const requestedLimit = Number(
      searchParams.get("limit") ?? MAX_TOOLKIT_PAGE,
    );
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), MAX_TOOLKIT_PAGE)
      : MAX_TOOLKIT_PAGE;

    const composioSession = await composio.create(session.user.id);
    const sessionToolkits: ToolkitsFn = (query) =>
      composioSession.toolkits(query as any);

    // Reconcile in parallel with the toolkit fetch; never fail the list if the
    // accounts call errors — fall back to the toolkit flags only.
    const activeAccountsPromise = listActiveAccountIdsByToolkit(
      session.user.id,
    ).catch((error) => {
      console.error(
        "[connections GET] connected-accounts reconcile failed:",
        error?.message ?? error,
      );
      return new Map<string, string>();
    });

    // Connected-only mode: the dashboard renders the ~10 connected apps, so
    // walking the 250-toolkit catalog to filter it down was ~6 sequential
    // round trips of pure waste. Ask Composio for the connected ones instead.
    if (connectedOnly) {
      const [connected, activeAccounts] = await Promise.all([
        walkToolkits(sessionToolkits, { isConnected: true }).catch((error) => {
          // The accounts reconcile below is authoritative and still runs, so
          // a failure here degrades the logos, not the list.
          console.error(
            "[connections GET] connected toolkit listing failed:",
            error?.message ?? error,
          );
          return [] as ToolkitListItem[];
        }),
        activeAccountsPromise,
      ]);

      const listed = new Set(
        connected.map((item) => String(item.slug).toLowerCase()),
      );
      const enriched = await fetchToolkitsBySlug(
        sessionToolkits,
        [...activeAccounts.keys()].filter((slug) => !listed.has(slug)),
      );

      return NextResponse.json({
        // `isConnected` is a server-side filter, but re-check it here: if the
        // SDK ever ignores the flag this returns a correct list rather than
        // the whole catalog.
        toolkits: mapToolkitsWithAccounts(
          [...connected, ...enriched],
          undefined,
          activeAccounts,
        ).filter((toolkit) => toolkit.isConnected),
      });
    }

    if (paginate) {
      const [page, activeAccounts] = await Promise.all([
        fetchToolkitPage(sessionToolkits, {
          limit,
          ...(search ? { search } : {}),
          ...(cursorParam ? { cursor: cursorParam } : {}),
        }),
        activeAccountsPromise,
      ]);

      return NextResponse.json({
        toolkits: mapToolkitsWithAccounts(page.items, search, activeAccounts, {
          // Connected apps the listing did not return are surfaced on the
          // first page only — repeating them under every "Load more" would
          // show the same entry several times.
          includeUnlisted: !cursorParam,
        }),
        nextCursor: page.nextCursor ?? null,
      });
    }

    // Legacy mode: exhaust all pages before responding. Without a search term
    // that is the whole catalog, which is identical for every user and served
    // from a shared cache; a search stays live because its result set is small
    // and the cache key would fragment per term anyway.
    const allItems = search
      ? await walkToolkits(sessionToolkits, { search })
      : await getToolkitCatalog(sessionToolkits);

    const activeAccounts = await activeAccountsPromise;

    return NextResponse.json({
      toolkits: mapToolkitsWithAccounts(allItems, search, activeAccounts),
    });
  } catch (error: any) {
    const detail =
      error?.response?.data ?? error?.cause ?? error?.message ?? String(error);
    console.error("[connections GET] Composio error:", JSON.stringify(detail));
    return NextResponse.json(
      { error: error.message || "Failed to fetch toolkits", detail },
      { status: 500 },
    );
  }
});

// POST: Start OAuth flow for a toolkit
export const POST = withAuth(async (req, session) => {
  try {
    const {
      toolkit,
      callbackUrl: bodyCallbackUrl,
    }: { toolkit: string; callbackUrl?: string } = await req.json();
    const origin = new URL(req.url).origin;
    const resolvedCallbackUrl = bodyCallbackUrl ?? origin;
    const composioSession = await composio.create(session.user.id);
    const connectionRequest = await composioSession.authorize(toolkit, {
      callbackUrl: resolvedCallbackUrl,
    });

    return NextResponse.json({ redirectUrl: connectionRequest.redirectUrl });
  } catch (error: any) {
    const detail =
      error?.response?.data ?? error?.cause ?? error?.message ?? String(error);
    console.error("[connections POST] Composio error:", JSON.stringify(detail));
    return NextResponse.json(
      { error: error.message || "Failed to initiate OAuth", detail },
      { status: 500 },
    );
  }
});
