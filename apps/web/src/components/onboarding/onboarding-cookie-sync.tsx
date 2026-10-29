"use client";

import { useEffect } from "react";

/**
 * Backfills the device-local onboarding cookie for users whose DB state is
 * already "done" (new device, cleared cookies, incognito). Keeps later loads
 * on the cookie fast-path without any redirect bounce.
 */
export function OnboardingCookieSync() {
  useEffect(() => {
    document.cookie =
      "onboarding_complete=1; path=/; max-age=31536000; samesite=lax";
  }, []);
  return null;
}
