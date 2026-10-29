"use client";
import useSWR, { SWRConfiguration } from "swr";
import { fetcher } from "lib/utils";

export type ProjectWorkflowRow = {
  id: string;
  workflowId: string;
  status: "active" | "paused";
  createdAt: string;
  name: string;
  description: string | null;
  icon: unknown;
};

export function useProjectWorkflows(
  projectId: string,
  options?: SWRConfiguration,
) {
  return useSWR<{ workflows: ProjectWorkflowRow[] }>(
    `/api/projects/${projectId}/workflows`,
    fetcher,
    { revalidateOnFocus: false, ...options },
  );
}
