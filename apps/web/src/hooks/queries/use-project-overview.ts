"use client";

import { fetcher } from "lib/utils";
import { useCallback } from "react";
import useSWR, { type SWRConfiguration } from "swr";

export type ProjectTodoStatus = "open" | "done" | "dismissed";

export type ProjectTodoRow = {
  id: string;
  key: string;
  title: string;
  detail: string | null;
  priority: "low" | "normal" | "high" | "critical";
  dueAt: string | null;
  sourceScope: string | null;
  sourceLabel: string | null;
  sourceUrl: string | null;
  status: ProjectTodoStatus;
  resolvedAt: string | null;
  createdAt: string;
};

export type ProjectOverviewResponse = {
  status: {
    health: "green" | "yellow" | "red" | "unknown";
    progressPct: number | null;
    summary: string;
    blockers: string[];
    generatedAt: string;
  } | null;
  connectorIssues: Array<{
    id: string;
    displayName: string;
    status: string;
    lastSyncError: string | null;
  }>;
  todos: ProjectTodoRow[];
  recentlyDone: ProjectTodoRow[];
};

export function projectOverviewKey(projectId: string) {
  return `/api/projects/${projectId}/overview`;
}

/**
 * The single project-level status + to-do view. `setTodoStatus` is optimistic:
 * the row moves between the open and recently-done lists immediately, then the
 * server answer revalidates.
 */
export function useProjectOverview(
  projectId: string,
  options?: SWRConfiguration<ProjectOverviewResponse>,
) {
  const swr = useSWR<ProjectOverviewResponse>(
    projectOverviewKey(projectId),
    fetcher,
    { revalidateOnFocus: false, errorRetryCount: 1, ...options },
  );
  const { mutate } = swr;

  const setTodoStatus = useCallback(
    async (todoId: string, status: ProjectTodoStatus) => {
      const now = new Date().toISOString();
      mutate(
        (current) => {
          if (!current) return current;
          const all = [...current.todos, ...current.recentlyDone];
          const target = all.find((todo) => todo.id === todoId);
          if (!target) return current;
          const updated: ProjectTodoRow = {
            ...target,
            status,
            resolvedAt: status === "open" ? null : now,
          };
          const rest = (list: ProjectTodoRow[]) =>
            list.filter((todo) => todo.id !== todoId);
          return {
            ...current,
            todos:
              status === "open"
                ? [updated, ...rest(current.todos)]
                : rest(current.todos),
            recentlyDone:
              status === "done"
                ? [updated, ...rest(current.recentlyDone)]
                : rest(current.recentlyDone),
          };
        },
        { revalidate: false },
      );

      const response = await fetch(
        `/api/projects/${projectId}/todos/${todoId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      ).catch(() => null);

      await mutate();
      if (!response?.ok) {
        throw new Error("todo_update_failed");
      }
    },
    [mutate, projectId],
  );

  return { ...swr, setTodoStatus };
}
