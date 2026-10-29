"use client";
import { Agent } from "app-types/agent";
import useSWR, { SWRConfiguration } from "swr";
import { handleErrorWithToast } from "ui/shared-toast";
import { fetcher } from "lib/utils";

interface UseAgentOptions extends SWRConfiguration {
  enabled?: boolean;
}

export function useAgent(
  agentId: string | null | undefined,
  options: UseAgentOptions = {},
) {
  const { enabled = true, ...swrOptions } = options;

  const {
    data: agent,
    error,
    isLoading,
    mutate,
  } = useSWR<Agent>(
    agentId && enabled ? `/api/agent/${agentId}` : null,
    fetcher,
    {
      errorRetryCount: 0,
      revalidateOnFocus: false,
      onError: handleErrorWithToast,
      ...swrOptions,
    },
  );

  return {
    agent,
    isLoading,
    error,
    mutate,
  };
}
