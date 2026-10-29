"use client";

import type { UIMessage } from "ai";
import { Button } from "./ui/button";
import {
  type Dispatch,
  type SetStateAction,
  useState,
  useMemo,
  useEffect,
} from "react";
import { Textarea } from "./ui/textarea";
import { deleteMessagesByChatIdAfterTimestampAction } from "@/app/api/chat/actions";
import type { UseChatHelpers } from "@ai-sdk/react";
import { useTranslations } from "next-intl";
import { Loader } from "lucide-react";

export type MessageEditorProps = {
  message: UIMessage;
  setMode: Dispatch<SetStateAction<"view" | "edit">>;
  setMessages: UseChatHelpers<UIMessage>["setMessages"];
  sendMessage: UseChatHelpers<UIMessage>["sendMessage"];
};

export function MessageEditor({
  message,
  setMode,
  setMessages,
  sendMessage,
}: MessageEditorProps) {
  const t = useTranslations();
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const canEdit = useMemo(
    () =>
      message.parts &&
      message.parts.length > 0 &&
      message.parts[message.parts.length - 1]?.type === "text",
    [message.parts],
  );

  const [draftText, setDraftText] = useState<string>(() => {
    if (canEdit) {
      const lastPart = message.parts[message.parts.length - 1] as any;
      return lastPart.text || "";
    }
    return "";
  });

  const handleTextChange = (value: string) => {
    setDraftText(value);
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);

    await deleteMessagesByChatIdAfterTimestampAction(message.id);

    setMessages((messages) => {
      const index = messages.findIndex((m) => m.id === message.id);

      if (index !== -1) {
        const updatedParts = [...message.parts];
        const lastPartIndex = updatedParts.length - 1;
        const lastPart = updatedParts[lastPartIndex];

        if (lastPart && lastPart.type === "text") {
          updatedParts[lastPartIndex] = {
            ...lastPart,
            text: draftText,
          };
        }

        const updatedMessage: UIMessage = {
          ...message,
          parts: updatedParts,
        };

        return [...messages.slice(0, index), updatedMessage];
      }

      return messages;
    });

    setMode("view");
    sendMessage();
  };
  useEffect(() => {
    if (!canEdit) {
      setMode("view");
    }
  }, [canEdit]);

  return (
    <div className="flex flex-col gap-4 w-full mb-4">
      <div className="flex flex-col gap-2">
        <Textarea
          data-testid="message-editor-text"
          className="overflow-y-auto bg-transparent outline-none overflow-hidden resize-none !text-base rounded-xl w-full min-h-[100px]"
          value={draftText}
          onChange={(e) => handleTextChange(e.target.value)}
          placeholder="Edit your message..."
        />
      </div>
      <div className="flex flex-row gap-2 justify-end">
        <Button
          variant="outline"
          size="sm"
          className="h-fit py-2 px-3"
          onClick={() => {
            setMode("view");
          }}
        >
          {t("Common.cancel")}
        </Button>
        <Button
          data-testid="message-editor-send-button"
          variant="default"
          size="sm"
          className="h-fit py-2 px-3"
          disabled={isSubmitting}
          onClick={handleSubmit}
        >
          {isSubmitting ? t("Common.saving") : t("Common.save")}
          {isSubmitting && <Loader className="size-4 animate-spin" />}
        </Button>
      </div>
    </div>
  );
}
