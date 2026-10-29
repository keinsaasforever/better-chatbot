"use client";

import { appStore } from "@/app/store";
import { ChatModel, ChatThread } from "app-types/chat";
import { useCallback } from "react";
import { mutate } from "swr";

export function useGenerateThreadTitle(option: {
  threadId: string;
  chatModel?: ChatModel;
}) {
  // Read through primitives, not the option object: callers pass an object
  // literal, so depending on it would give every render a new callback and
  // re-run the effects that hold it.
  const { threadId, chatModel } = option;

  const updateTitle = useCallback(
    (title: string) => {
      appStore.setState((prev) => {
        const exists = prev.threadList.some((v) => v.id === threadId);
        if (!exists) {
          return {
            threadList: [
              {
                id: threadId,
                title,
                userId: "",
                createdAt: new Date(),
              },
              ...prev.threadList,
            ],
          };
        }

        return {
          threadList: prev.threadList.map((v) =>
            v.id === threadId ? { ...v, title } : v,
          ),
        };
      });
    },
    [threadId],
  );

  const generateTitle = useCallback(
    async (message: string) => {
      const trimmed = message.trim();
      if (!trimmed) return;
      if (appStore.getState().generatingTitleThreadIds.includes(threadId))
        return;

      appStore.setState((prev) => ({
        generatingTitleThreadIds: [...prev.generatingTitleThreadIds, threadId],
      }));

      try {
        const response = await fetch("/api/chat/title", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            threadId,
            chatModel: chatModel ?? appStore.getState().chatModel,
          }),
        });
        if (!response.ok) {
          throw new Error(`Title request failed: ${response.status}`);
        }
        const { title } = (await response.json()) as { title?: string };
        const nextTitle = title?.trim();
        if (!nextTitle) return;

        updateTitle(nextTitle);
        // The server persists before responding, so the title is already
        // durable here. Write it straight into the sidebar's cache (instant, no
        // flicker) and revalidate to pick up a thread the list has never seen.
        await mutate<ChatThread[]>(
          "/api/thread",
          (prev) =>
            prev?.map((thread) =>
              thread.id === threadId ? { ...thread, title: nextTitle } : thread,
            ),
          { revalidate: true },
        );
      } catch (error) {
        // A missing title is recoverable: the chat route titles the thread
        // server-side when a run ends untitled.
        console.error("Failed to generate thread title:", error);
      } finally {
        appStore.setState((prev) => ({
          generatingTitleThreadIds: prev.generatingTitleThreadIds.filter(
            (v) => v !== threadId,
          ),
        }));
      }
    },
    [chatModel, threadId, updateTitle],
  );

  return generateTitle;
}
