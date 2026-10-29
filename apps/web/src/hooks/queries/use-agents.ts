"use client";
import { appStore } from "@/app/store";
import useSWR, { SWRConfiguration, useSWRConfig } from "swr";
import { handleErrorWithToast } from "ui/shared-toast";
import { fetcher } from "lib/utils";
import { AgentSummary } from "app-types/agent";
import { authClient } from "auth/client";

interface UseAgentsOptions extends SWRConfiguration {
  filters?: ("all" | "mine" | "shared" | "bookmarked")[];
  limit?: number;
}

export function useAgents(options: UseAgentsOptions = {}) {
  const { filters = ["all"], limit = 50, ...swrOptions } = options;

  // Build query string with filters
  const filtersParam = filters.join(",");
  const queryParams = new URLSearchParams({
    filters: filtersParam,
    limit: limit.toString(),
  });

  const {
    data: agents = [],
    error,
    isLoading,
    mutate,
  } = useSWR<AgentSummary[]>(`/api/agent?${queryParams.toString()}`, fetcher, {
    errorRetryCount: 0,
    revalidateOnFocus: false,
    fallbackData: [],
    onError: handleErrorWithToast,
    onSuccess: (data) => {
      // Update Zustand store for chat mentions
      appStore.setState({ agentList: data });
    },
    ...swrOptions,
  });

  const { data: session } = authClient.useSession();
  const currentUserId = session?.user?.id;

  // Client-side filtering for additional views
  const filterAgents = (filterFn: (agent: AgentSummary) => boolean) => {
    return agents.filter(filterFn);
  };

  return {
    agents, // All returned agents based on server filters
    myAgents: filterAgents((agent) => agent.userId === currentUserId),
    sharedAgents: filterAgents((agent) => agent.userId !== currentUserId),
    bookmarkedAgents: filterAgents(
      (agent) => agent.userId !== currentUserId && agent.isBookmarked === true,
    ),
    publicAgents: filterAgents((agent) => agent.visibility === "public"),
    readonlyAgents: filterAgents((agent) => agent.visibility === "readonly"),
    isLoading,
    error,
    mutate,
    // Helper to check if any agents exist of a certain type
    hasAgents: (
      type: "mine" | "shared" | "bookmarked" | "public" | "readonly",
    ) => {
      switch (type) {
        case "mine":
          return agents.some((agent) => agent.userId === currentUserId);
        case "shared":
          return agents.some((agent) => agent.userId !== currentUserId);
        case "bookmarked":
          return agents.some(
            (agent) => agent.userId !== currentUserId && agent.isBookmarked,
          );
        case "public":
          return agents.some((agent) => agent.visibility === "public");
        case "readonly":
          return agents.some((agent) => agent.visibility === "readonly");
      }
    },
  };
}

// Utility hook to invalidate all agent caches
export function useMutateAgents() {
  const { mutate } = useSWRConfig();

  return (
    updatedAgent?: Partial<AgentSummary> & { id: string },
    deleteAgent?: boolean,
  ) => {
    // Update all agent list endpoints (with or without query strings)
    mutate(
      (key) => {
        if (typeof key !== "string") return false;
        // Match /api/agent or /api/agent?... but not /api/agent/id
        return (
          key.startsWith("/api/agent") && !key.match(/\/api\/agent\/[^/?]+/)
        );
      },
      (cachedData: any) => {
        if (!cachedData || !Array.isArray(cachedData) || !updatedAgent)
          return cachedData;

        // Handle agent deletion
        if (deleteAgent) {
          return cachedData.filter(
            (agent: AgentSummary) => agent.id !== updatedAgent?.id,
          );
        }

        // Handle agent update/creation
        const existingIndex = cachedData.findIndex(
          (agent: AgentSummary) => agent.id === updatedAgent?.id,
        );

        if (existingIndex >= 0) {
          // Update existing agent
          const newData = [...cachedData];
          newData[existingIndex] = {
            ...newData[existingIndex],
            ...updatedAgent,
          };
          return newData;
        } else {
          // Add new agent at the beginning
          return [updatedAgent, ...cachedData];
        }
      },
      { revalidate: true },
    );

    // Also update individual agent caches if we have an agent ID
    if (updatedAgent?.id) {
      if (deleteAgent) {
        // For deleted agents, invalidate the individual cache
        mutate(`/api/agent/${updatedAgent.id}`, undefined, {
          revalidate: true,
        });
      } else {
        // For updated agents, update the individual cache
        mutate(
          `/api/agent/${updatedAgent.id}`,
          (cachedData: any) => {
            if (!cachedData) return cachedData;
            return { ...cachedData, ...updatedAgent };
          },
          { revalidate: true },
        );
      }
    }
  };
}
