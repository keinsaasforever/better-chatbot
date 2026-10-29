"use client";
import { useMemo } from "react";
import useSWR from "swr";
import { fetcher } from "lib/utils";

export type ScheduledTaskSummary = {
  id: string;
  userId: string;
  taskType: "agent";
  agentId: string;
  key: string;
  name: string;
  description: string | null;
  cronExpression: string;
  timezone: string;
  inputPrompt: string | null;
  enabled: boolean | null;
  lastRunAt: string | null;
  lastRunStatus: "success" | "failure" | "timeout" | null;
  lastRunError: string | null;
  lastChatThreadId: string | null;
  runCount: number | null;
  successCount: number | null;
  failureCount: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  agentName: string | null;
  nextRunAt: string | null;
};

export function useScheduledTasks() {
  const { data, isLoading, mutate } = useSWR<{
    tasks: ScheduledTaskSummary[];
  }>("/api/scheduled-tasks", fetcher, {
    revalidateOnFocus: false,
    errorRetryCount: 1,
  });

  const byAgentId = useMemo(() => {
    const map = new Map<string, ScheduledTaskSummary>();
    for (const task of data?.tasks ?? []) {
      if (!map.has(task.agentId)) map.set(task.agentId, task);
    }
    return map;
  }, [data?.tasks]);

  return {
    tasks: data?.tasks ?? [],
    byAgentId,
    isLoading,
    mutate,
  };
}

/**
 * All schedules belonging to a single agent. Backed by the server's ?agentId=
 * filter (which previously was ignored — see api/scheduled-tasks GET), so the
 * list is scoped to the agent instead of "whatever row came back first".
 */
export function useAgentSchedules(agentId: string | undefined) {
  const { data, isLoading, mutate } = useSWR<{ tasks: ScheduledTaskSummary[] }>(
    agentId ? `/api/scheduled-tasks?agentId=${agentId}` : null,
    fetcher,
    { revalidateOnFocus: false, errorRetryCount: 1 },
  );

  return {
    schedules: data?.tasks ?? [],
    isLoading,
    mutate,
  };
}
