"use client";

import { deleteMessageAction } from "@/app/api/chat/actions";
import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { notify } from "lib/notify";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { safe } from "ts-safe";

export type MessagePart = UIMessage["parts"][number];
export type TextMessagePart = Extract<MessagePart, { type: "text" }>;

export function useDeleteMessage(
  messageId: string,
  setMessages?: UseChatHelpers<UIMessage>["setMessages"],
) {
  const [isDeleting, setIsDeleting] = useState(false);
  const deleteMessage = useCallback(async () => {
    if (!setMessages) return;
    const ok = await notify.confirm({
      title: "Delete Message",
      description: "Are you sure you want to delete this message?",
    });
    if (!ok) return;
    safe(() => setIsDeleting(true))
      .ifOk(() => deleteMessageAction(messageId))
      .ifOk(() =>
        setMessages((messages) => {
          const index = messages.findIndex((m) => m.id === messageId);
          if (index !== -1) {
            return messages.filter((_, i) => i !== index);
          }
          return messages;
        }),
      )
      .ifFail((error) => toast.error(error.message))
      .watch(() => setIsDeleting(false))
      .unwrap();
  }, [messageId]);
  return { isDeleting, deleteMessage };
}
