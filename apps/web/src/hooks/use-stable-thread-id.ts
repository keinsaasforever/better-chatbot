"use client";

import { generateUUID } from "lib/utils";
import { useState } from "react";

/**
 * Resolves the thread id a chat should use, holding it stable for the lifetime
 * of the component.
 *
 * Routes that own a real thread (`/chat/[thread]`) pass one in and it is always
 * used, so switching threads still works. The `/` home page passes nothing: it
 * is `force-dynamic`, so every server render — including the RSC tree Next
 * returns after a Server Action — used to mint a different UUID. That reached
 * the chat as a changed prop, rebuilding the Chat instance and re-firing every
 * threadId-keyed effect, which users saw as the app loading a second time.
 */
export function useStableThreadId(threadId?: string): string {
  const [fallbackThreadId] = useState(generateUUID);
  return threadId ?? fallbackThreadId;
}
