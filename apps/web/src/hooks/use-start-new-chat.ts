"use client";

import { appStore } from "@/app/store";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

/**
 * The one "New chat" action, shared by the sidebar button, the sidebar logo and
 * the keyboard shortcut.
 *
 * Routing alone cannot start a new chat. `/` mints its thread id on the client
 * and holds it for the lifetime of the mount (`use-stable-thread-id`), and the
 * first send only *rewrites* the address bar to /chat/<id> — the rendered route
 * is still "/". So from a chat started on "/", neither `router.push("/")` (same
 * route segment) nor `router.refresh()` (documented to keep client state)
 * unmounts `ChatBot`: the old conversation stayed on screen and users pressed
 * the button a second time.
 *
 * The reset is therefore explicit: bump `newChatToken`, which `HomeChat` uses
 * as `ChatBot`'s key, so the chat remounts with a fresh id and an empty
 * composer. The push then only has to fix the URL, or carry the user home from
 * a different route — where the remount happens anyway and the bump is a no-op.
 */
export function useStartNewChat() {
  const router = useRouter();

  return useCallback(() => {
    appStore.setState((prev) => ({ newChatToken: prev.newChatToken + 1 }));
    if (window.location.pathname !== "/") {
      router.push("/");
    }
  }, [router]);
}
