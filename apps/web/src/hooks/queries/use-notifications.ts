"use client";
import { useCallback, useRef } from "react";
import useSWR, { useSWRConfig } from "swr";
import { fetcher } from "lib/utils";
import type { NotificationEntity } from "@/lib/db/pg/schema.pg";

export type NotificationItem = Omit<
  NotificationEntity,
  "createdAt" | "readAt"
> & {
  createdAt: string;
  readAt: string | null;
};

type NotificationsResponse = {
  notifications: NotificationItem[];
  unreadCount: number;
};

/**
 * Polls the notification feed. When a new notification id shows up, the
 * thread list is revalidated too — a background run finishing is exactly the
 * moment its (possibly new) thread should appear in the sidebar.
 */
export function useNotifications() {
  const { mutate: globalMutate } = useSWRConfig();
  const seenIds = useRef<Set<string> | null>(null);

  const { data, isLoading, mutate } = useSWR<NotificationsResponse>(
    "/api/notifications",
    fetcher,
    {
      refreshInterval: 60_000,
      // Per-hook override of the app-wide revalidateOnFocus: false — coming
      // back to the tab is when "what happened while I was away" matters.
      revalidateOnFocus: true,
      errorRetryCount: 1,
      onSuccess: (response) => {
        const ids = new Set(response.notifications.map((n) => n.id));
        const previous = seenIds.current;
        seenIds.current = ids;
        if (!previous) return;
        const hasNew = response.notifications.some((n) => !previous.has(n.id));
        if (hasNew) {
          globalMutate("/api/thread");
        }
      },
    },
  );

  const markRead = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      // Optimistic: clear locally, then persist and revalidate.
      mutate(
        (current) =>
          current && {
            notifications: current.notifications.map((n) =>
              ids.includes(n.id) && !n.readAt
                ? { ...n, readAt: new Date().toISOString() }
                : n,
            ),
            unreadCount: Math.max(
              0,
              current.unreadCount -
                current.notifications.filter(
                  (n) => ids.includes(n.id) && !n.readAt,
                ).length,
            ),
          },
        { revalidate: false },
      );
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      }).catch(() => null);
      mutate();
    },
    [mutate],
  );

  const markAllRead = useCallback(async () => {
    mutate(
      (current) =>
        current && {
          notifications: current.notifications.map((n) =>
            n.readAt ? n : { ...n, readAt: new Date().toISOString() },
          ),
          unreadCount: 0,
        },
      { revalidate: false },
    );
    await fetch("/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch(() => null);
    mutate();
  }, [mutate]);

  return {
    notifications: data?.notifications ?? [],
    unreadCount: data?.unreadCount ?? 0,
    isLoading,
    markRead,
    markAllRead,
    mutate,
  };
}
