"use client";

import { useEffect, useState } from "react";

/**
 * Whether the page is running on iOS (iPhone, iPad or iPod).
 *
 * Exists for one reason: iOS Safari will not render a PDF inside an
 * `<iframe>`. Every other browser shows the document; iOS shows a blank or
 * unscrollable frame, so a panel that iframes a PDF looks broken on exactly
 * the device most likely to open a chat attachment.
 *
 * iPadOS 13+ reports a desktop Mac user-agent on purpose, so the string test
 * alone misses every iPad. `maxTouchPoints` is what separates an iPad from a
 * Mac — a trackpad reports 0.
 *
 * Deliberately returns false until after mount: the server has no user agent,
 * and branching on one during render is a hydration mismatch. The first paint
 * is therefore the non-iOS branch, which is the correct fallback anyway.
 */
export function useIsIOS(): boolean {
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const ua = navigator.userAgent;
    setIsIOS(
      /iPad|iPhone|iPod/.test(ua) ||
        (/Mac/.test(ua) && navigator.maxTouchPoints > 1),
    );
  }, []);

  return isIOS;
}
