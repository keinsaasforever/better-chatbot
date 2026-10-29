"use client";
import useSWR, { SWRConfiguration } from "swr";
import { fetcher } from "lib/utils";

export type ProjectAgentRow = {
  id: string;
  agentId: string;
  status: "active" | "paused";
  createdAt: string;
  name: string;
  description: string | null;
  icon: unknown;
};

export function useProjectAgents(
  projectId: string,
  options?: SWRConfiguration,
) {
  return useSWR<{ agents: ProjectAgentRow[] }>(
    `/api/projects/${projectId}/agents`,
    fetcher,
    { revalidateOnFocus: false, ...options },
  );
}
