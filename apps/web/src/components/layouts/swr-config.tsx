"use client";

import { BasicUser } from "app-types/user";
import { useEffect, useMemo } from "react";
import { SWRConfig, SWRConfiguration } from "swr";

export function SWRConfigProvider({
  children,
  user,
}: {
  children: React.ReactNode;
  user?: BasicUser;
}) {
  const config = useMemo<SWRConfiguration>(() => {
    return {
      // Disable focus/reconnect revalidation to prevent unwanted reloads
      // See: https://swr.vercel.app/docs/revalidation
      // Mobile browsers treat app switching as "focus" events, causing reloads
      // Keep revalidateIfStale: true (default) to allow initial data fetching
      revalidateOnFocus: false, // Don't revalidate when window/tab gains focus
      revalidateOnReconnect: false, // Don't revalidate when network reconnects
      focusThrottleInterval: 30000, // Throttle to 30s if focus revalidation enabled
      dedupingInterval: 2000, // Dedupe requests within 2s
      errorRetryCount: 1, // Only retry once on error
      fallback: {
        "/api/user/details": user,
      },
    };
  }, [user]);

  useEffect(() => {
    console.log(
      "%cKeinSaaS Navigator\n%c🚀 Visit us at www.keinsaas.com",
      "color: #00d4ff; font-weight: bold; font-family: monospace; font-size: 16px; text-shadow: 0 0 10px #00d4ff;",
      "color: #888; font-size: 12px;",
    );
  }, []);
  return <SWRConfig value={config}>{children}</SWRConfig>;
}
