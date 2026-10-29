"use client";

import { appStore } from "@/app/store";
import ChatBot from "@/components/chat-bot";
import type { UIMessage } from "ai";

/**
 * Stable identity: a fresh `[]` per render would hand `useChat` a new
 * `messages` option every time the token changes.
 */
const NO_MESSAGES: UIMessage[] = [];

/**
 * The chat on "/".
 *
 * Keyed on `newChatToken` so `useStartNewChat` can remount it — that remount is
 * what mints a new thread id and clears the composer. Nothing else may change
 * this key: an id that moves on an unrelated re-render is the double-load bug
 * `use-stable-thread-id` exists to prevent.
 */
export function HomeChat() {
  const newChatToken = appStore((state) => state.newChatToken);

  return <ChatBot key={newChatToken} initialMessages={NO_MESSAGES} />;
}
