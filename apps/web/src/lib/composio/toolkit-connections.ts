import { COMPOSIO_PRIORITY_APPS } from "./priority";

export type MappedToolkit = {
  slug: string;
  name: string;
  logo?: string;
  isConnected: boolean;
  connectedAccountId?: string;
};

/** "google_sheets" -> "Google Sheets", for a toolkit we only know by slug. */
function titleFromSlug(slug: string): string {
  return (
    slug
      .split(/[_\-.]+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ") || slug
  );
}

/**
 * Map raw `session.toolkits()` items to the /api/connections response shape,
 * reconciling the (lagging) toolkit connection flags with the authoritative
 * set of ACTIVE connected accounts (slug → account id). A toolkit counts as
 * connected when either source says so.
 *
 * `includeUnlisted` (default true) also emits an entry for any active account
 * whose toolkit is absent from `items`. Without it the reconcile could only
 * *enrich* a toolkit the listing already returned, never add one — so a
 * connected app that `toolkits()` did not hand back on this call, or on this
 * page, disappeared from the UI entirely. That is the "I have tools connected
 * and they are not shown" report. Pass false for pages after the first, where
 * these entries would otherwise repeat.
 */
export function mapToolkitsWithAccounts(
  items: any[],
  search?: string,
  activeAccounts?: Map<string, string>,
  { includeUnlisted = true }: { includeUnlisted?: boolean } = {},
): MappedToolkit[] {
  // Annotated rather than inferred: the inferred element type would carry a
  // required `logo` (from `t.logo`), and the synthesised entries below have no
  // logo to give. MappedToolkit has it optional, which is the truth here.
  const mapped: MappedToolkit[] = items
    .filter(
      (t) => !t.isNoAuth || activeAccounts?.has(String(t.slug).toLowerCase()),
    )
    .map((t) => {
      const fallbackAccountId = activeAccounts?.get(
        String(t.slug).toLowerCase(),
      );
      return {
        slug: t.slug,
        name: t.name,
        logo: t.logo,
        isConnected: (t.connection?.isActive ?? false) || !!fallbackAccountId,
        connectedAccountId:
          t.connection?.connectedAccount?.id ?? fallbackAccountId,
      };
    });

  if (includeUnlisted && activeAccounts?.size) {
    const seen = new Set(mapped.map((t) => String(t.slug).toLowerCase()));
    for (const [slug, accountId] of activeAccounts) {
      if (seen.has(slug)) continue;
      // An active account is proof the toolkit is connected, so show it even
      // though the listing did not describe it. Only the slug is known here;
      // the name is derived and there is no logo.
      mapped.push({
        slug,
        name: titleFromSlug(slug),
        isConnected: true,
        connectedAccountId: accountId,
      });
    }
  }

  return mapped.sort((a, b) => {
    if (!search) {
      const aIdx = COMPOSIO_PRIORITY_APPS.indexOf(a.slug);
      const bIdx = COMPOSIO_PRIORITY_APPS.indexOf(b.slug);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
    }
    return a.name.localeCompare(b.name);
  });
}

export type ComposioAccountCandidate = {
  id: string;
  isDisabled: boolean;
  createdAt?: string;
  toolkit: { slug: string };
};

/**
 * Pick the connected account to bind a project connector to. With an explicit
 * `connectionRef` the id must match exactly; without one (e.g. right after
 * OAuth, before the client learned the id) the newest active account for the
 * toolkit wins.
 */
export function resolveComposioAccount<T extends ComposioAccountCandidate>(
  items: T[],
  toolkitSlug: string,
  connectionRef?: string,
): T | undefined {
  const candidates = items.filter(
    (candidate) =>
      candidate.toolkit.slug.toLowerCase() === toolkitSlug &&
      !candidate.isDisabled,
  );

  if (connectionRef) {
    return candidates.find((candidate) => candidate.id === connectionRef);
  }

  return [...candidates].sort(
    (a, b) =>
      new Date(b.createdAt ?? 0).getTime() -
      new Date(a.createdAt ?? 0).getTime(),
  )[0];
}
