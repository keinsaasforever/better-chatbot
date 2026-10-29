"use client";

import {
  type DesktopAuthBridge,
  getDesktopAuthBridge,
} from "@/lib/auth/desktop-sign-in";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type DesktopSignInPage = "sign-in" | "sign-up";

/**
 * Routes a social sign-in through the system browser when the page runs in
 * the desktop app. `available` is false on the server and in ordinary
 * browsers, so callers fall through to the usual in-window flow there.
 */
export function useDesktopBrowserSignIn({
  page,
  callbackUrl,
}: {
  page: DesktopSignInPage;
  callbackUrl?: string;
}) {
  const t = useTranslations("Auth.Desktop");
  // Read through a ref so the subscription below is not torn down and
  // re-created on every render.
  const tRef = useRef(t);
  tRef.current = t;
  // Resolved in an effect so server and first client render agree.
  const [bridge, setBridge] = useState<DesktopAuthBridge | undefined>();
  const [pending, setPending] = useState(false);
  const lastProvider = useRef<string | null>(null);

  useEffect(() => {
    setBridge(getDesktopAuthBridge());
  }, []);

  useEffect(() => {
    if (!bridge || typeof bridge.onBrowserSignInFailed !== "function") return;
    return bridge.onBrowserSignInFailed(({ reason }) => {
      toast.error(
        reason === "expired"
          ? tRef.current("handoffExpired")
          : tRef.current("handoffFailed"),
      );
      setPending(false);
    });
  }, [bridge]);

  const start = useCallback(
    async (provider: string): Promise<boolean> => {
      if (!bridge) return false;
      lastProvider.current = provider;
      setPending(true);
      try {
        await bridge.startBrowserSignIn({ page, provider, callbackUrl });
      } catch {
        setPending(false);
        toast.error(tRef.current("handoffFailed"));
      }
      return true;
    },
    [bridge, page, callbackUrl],
  );

  const reopen = useCallback(() => {
    if (lastProvider.current) void start(lastProvider.current);
  }, [start]);

  const cancel = useCallback(() => setPending(false), []);

  return { available: bridge !== undefined, pending, start, reopen, cancel };
}
