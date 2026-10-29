"use client";
import useSWR, { type SWRConfiguration } from "swr";
import { fetcher } from "lib/utils";
import { handleErrorWithToast } from "ui/shared-toast";

export type ComposioToolkit = {
  slug: string;
  name: string;
  logo?: string;
  isConnected: boolean;
  connectedAccountId?: string;
};

type Options = SWRConfiguration & {
  /**
   * Fetch only the toolkits this user has connected. Callers that render just
   * the connected apps want this: the default walks the whole ~250-toolkit
   * catalog server-side, which costs several sequential round trips to
   * Composio and ships a payload the caller throws away.
   */
  connectedOnly?: boolean;
};

export function useComposioConnections(search?: string, options?: Options) {
  const { connectedOnly, ...swrOptions } = options ?? {};

  const params = new URLSearchParams();
  if (search?.trim()) params.set("search", search.trim());
  if (connectedOnly) params.set("connectedOnly", "true");
  const query = params.toString();

  return useSWR<{ toolkits: ComposioToolkit[] }>(
    query ? `/api/connections?${query}` : "/api/connections",
    fetcher,
    {
      revalidateOnFocus: false,
      errorRetryCount: 0,
      dedupingInterval: 5000,
      onError: handleErrorWithToast,
      ...swrOptions,
    },
  );
}
