"use client";

import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import {
  COCKPIT_UPDATE_TYPES,
  type CockpitUpdateSeverity,
  cockpitUpdateType,
} from "lib/cockpit/updates";
import { fetcher } from "lib/utils";
import type { NotificationItem } from "./use-notifications";

/** All three severities: `cockpit_update`, `.warn` and `.alert`. */
export const COCKPIT_UPDATES_KEY = `/api/notifications?type=${COCKPIT_UPDATE_TYPES.join(",")}&limit=8`;

/** Event the voice session dispatches when `cockpit_push_update` returns. */
export const COCKPIT_UPDATE_EVENT = "cockpit:update";

export type CockpitUpdateEventDetail = {
  id?: string;
  title: string;
  body?: string | null;
  severity?: CockpitUpdateSeverity;
  url?: string | null;
};

const isSeverity = (v: unknown): v is CockpitUpdateSeverity =>
  v === "info" || v === "warn" || v === "alert";

/**
 * Called by the voice session with each finished server tool call. A
 * `cockpit_push_update` that posted a row announces it, so an open cockpit
 * shows it before its next poll. Replays (`posted: false`) stay silent: their
 * row is already on the display.
 */
export function announceCockpitPushUpdate(
  toolName: string,
  args: unknown,
  output: unknown,
): void {
  if (toolName !== "cockpit_push_update" || typeof window === "undefined") {
    return;
  }
  const input = (args ?? {}) as Record<string, unknown>;
  const result = (output ?? {}) as Record<string, unknown>;
  if (result.posted !== true || typeof input.title !== "string") return;
  const detail: CockpitUpdateEventDetail = {
    id: typeof result.id === "string" ? result.id : undefined,
    title: input.title,
    body: typeof input.body === "string" ? input.body : null,
    severity: isSeverity(result.severity)
      ? result.severity
      : isSeverity(input.severity)
        ? input.severity
        : "info",
    url: typeof input.url === "string" ? input.url : null,
  };
  window.dispatchEvent(new CustomEvent(COCKPIT_UPDATE_EVENT, { detail }));
}

type Response = { notifications: NotificationItem[]; unreadCount: number };

/**
 * The cockpit UPDATES feed: the latest `cockpit_update*` notifications, polled
 * every 5 s. A `cockpit:update` window event (voice tool result) shows the
 * row immediately and triggers a revalidation, so the voice agent's update
 * does not wait for the next poll.
 */
export function useCockpitUpdates() {
  const { data, isLoading, mutate } = useSWR<Response>(
    COCKPIT_UPDATES_KEY,
    fetcher,
    { refreshInterval: 5000, revalidateOnFocus: true, errorRetryCount: 2 },
  );
  const [optimistic, setOptimistic] = useState<NotificationItem[]>([]);

  useEffect(() => {
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<CockpitUpdateEventDetail>).detail;
      if (!detail?.title) return;
      const row: NotificationItem = {
        id: detail.id ?? `optimistic-${Date.now()}`,
        userId: "",
        type: cockpitUpdateType(detail.severity ?? "info"),
        title: detail.title,
        body: detail.body ?? null,
        url: detail.url ?? null,
        threadId: null,
        agentId: null,
        dedupeKey: null,
        readAt: null,
        createdAt: new Date().toISOString(),
      };
      setOptimistic((prev) => [row, ...prev].slice(0, 8));
      // The tool ran server-side before the event fired, so the row is
      // persisted: once the feed has refetched, the server copy replaces it.
      void mutate().finally(() =>
        setOptimistic((prev) => prev.filter((r) => r.id !== row.id)),
      );
    };
    window.addEventListener(COCKPIT_UPDATE_EVENT, onUpdate);
    return () => window.removeEventListener(COCKPIT_UPDATE_EVENT, onUpdate);
  }, [mutate]);

  const server = data?.notifications ?? [];
  // An event without an id gets a placeholder one, so it is matched to its
  // persisted row by content instead. Otherwise a poll that lands before the
  // revalidation above settles shows the update twice.
  const pending = optimistic.filter(
    (o) =>
      !server.some(
        (s) =>
          s.id === o.id ||
          (o.id.startsWith("optimistic-") &&
            s.type === o.type &&
            s.title === o.title),
      ),
  );
  const updates = [...pending, ...server].slice(0, 8);

  const markRead = useCallback(
    async (id: string) => {
      if (id.startsWith("optimistic-")) return;
      mutate(
        (current) =>
          current && {
            ...current,
            notifications: current.notifications.map((n) =>
              n.id === id && !n.readAt
                ? { ...n, readAt: new Date().toISOString() }
                : n,
            ),
          },
        { revalidate: false },
      );
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      }).catch(() => null);
      void mutate();
    },
    [mutate],
  );

  return { updates, isLoading, markRead };
}
