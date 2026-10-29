"use client";

import { useEffect } from "react";
import useSWR from "swr";
import type { UserPreferences } from "app-types/user";
import { fetcher } from "lib/utils";
import { resolveNotificationPrefs } from "@/lib/agent-alerts/resolve-notification-prefs";
import { setCachedNotificationPrefs } from "@/lib/agent-alerts/prefs-cache";

export function AgentNotificationPrefsSync() {
  const { data } = useSWR<UserPreferences>("/api/user/preferences", fetcher, {
    revalidateOnFocus: false,
    // Shared key with the preferences dialog. Deduping past the app-wide 2s
    // default keeps a later mount from re-fetching what boot already loaded.
    dedupingInterval: 60_000,
  });

  useEffect(() => {
    if (!data) return;
    setCachedNotificationPrefs(resolveNotificationPrefs(data.notifications));
  }, [data]);

  return null;
}
