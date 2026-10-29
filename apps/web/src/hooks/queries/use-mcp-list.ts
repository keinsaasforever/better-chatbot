"use client";
import { appStore } from "@/app/store";
import useSWR, { SWRConfiguration } from "swr";
import { handleErrorWithToast } from "ui/shared-toast";
import { fetcher, objectFlow } from "lib/utils";
import { MCPServerInfo } from "app-types/mcp";

export function useMcpList(options?: SWRConfiguration) {
  return useSWR<MCPServerInfo[]>("/api/mcp/list", fetcher, {
    revalidateOnFocus: false,
    errorRetryCount: 0,
    focusThrottleInterval: 1000 * 60 * 5,
    fallbackData: [],
    onError: handleErrorWithToast,
    refreshInterval: 0, // Disabled polling to reduce Vercel function invocations
    dedupingInterval: 5000, // Phase 4.1: Prevent duplicate requests within 5s
    onSuccess: (data) => {
      // SWR is the single source for the server list; prune persisted
      // allowedMcpServers of any server that no longer exists.
      const ids = data.map((v) => v.id);
      appStore.setState((prev) => ({
        allowedMcpServers: objectFlow(prev.allowedMcpServers || {}).filter(
          (_, key) => ids.includes(key),
        ),
      }));
    },
    ...options,
  });
}
