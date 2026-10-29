"use client";

import { useCopy } from "@/hooks/use-copy";
import type { UseChatHelpers } from "@ai-sdk/react";
import { UIMessage } from "ai";
import equal from "lib/equal";
import { scrollToScrollportTop } from "lib/scroll-to-scrollport-top";
import { cn, truncateString } from "lib/utils";
import {
  Check,
  ChevronDownIcon,
  ChevronUp,
  Copy,
  Loader,
  Pencil,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { memo, useEffect, useRef, useState } from "react";
import { Button } from "ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { MessageEditor } from "../message-editor";
import { type TextMessagePart, useDeleteMessage } from "./shared";

interface UserMessagePartProps {
  part: TextMessagePart;
  isLast: boolean;
  message: UIMessage;
  setMessages?: UseChatHelpers<UIMessage>["setMessages"];
  sendMessage?: UseChatHelpers<UIMessage>["sendMessage"];
  status?: UseChatHelpers<UIMessage>["status"];
  isError?: boolean;
  readonly?: boolean;
}

const MAX_TEXT_LENGTH = 600;
export const UserMessagePart = memo(
  function UserMessagePart({
    part,
    isLast,
    status,
    message,
    setMessages,
    sendMessage,
    readonly,
    isError,
  }: UserMessagePartProps) {
    const { copied, copy } = useCopy();
    const t = useTranslations();
    const [mode, setMode] = useState<"view" | "edit">("view");
    const { isDeleting, deleteMessage } = useDeleteMessage(
      message.id,
      setMessages,
    );
    const [expanded, setExpanded] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const scrolledRef = useRef(false);

    const isLongText = part.text.length > MAX_TEXT_LENGTH;
    const displayText =
      expanded || !isLongText
        ? part.text
        : truncateString(part.text, MAX_TEXT_LENGTH);

    useEffect(() => {
      if (status === "submitted" && isLast && !scrolledRef.current) {
        scrolledRef.current = true;
        // Pin the just-sent prompt to the top of the chat scroll region (which
        // starts below the app header). scrollIntoView() would also scroll
        // ancestor scrollports and overshoots on mobile, hiding the prompt
        // behind the header.
        scrollToScrollportTop(ref.current);
      }
    }, [status]);

    if (mode === "edit" && setMessages && sendMessage) {
      return (
        <div className="flex flex-row gap-2 items-start w-full">
          <MessageEditor
            message={message}
            setMode={setMode}
            setMessages={setMessages}
            sendMessage={sendMessage}
          />
        </div>
      );
    }

    return (
      // `data-user-message` lets chat-bot measure the newest prompt so it can
      // reserve exactly the room left below it (see lib/chat-tail-reserve.ts).
      <div
        data-user-message={isLast ? "last" : undefined}
        className="flex flex-col gap-2 items-end my-2 min-w-0 max-w-full"
      >
        <div
          data-testid="message-content"
          className={cn(
            "flex flex-col gap-4 max-w-full ring ring-input relative overflow-hidden",
            {
              "bg-accent text-accent-foreground px-4 py-3 rounded-2xl": isLast,
              "opacity-50": isError,
            },
            isError && "border-destructive border",
          )}
        >
          {isLongText && !expanded && (
            <div className="absolute pointer-events-none bg-gradient-to-t from-accent to-transparent w-full h-40 bottom-0 left-0" />
          )}
          <p className={cn("whitespace-pre-wrap text-sm break-words")}>
            {displayText}
          </p>
          {isLongText && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
              className="h-auto p-1 text-xs z-10 text-muted-foreground hover:text-foreground self-start"
            >
              <span className="flex items-center gap-1">
                {t(expanded ? "Common.showLess" : "Common.showMore")}
                {expanded ? (
                  <ChevronUp className="size-3" />
                ) : (
                  <ChevronDownIcon className="size-3" />
                )}
              </span>
            </Button>
          )}
        </div>
        {/* Copy is offered on every prompt in the thread. Edit and delete stay
            on the newest one, since rewriting a message mid-thread would strip
            everything the assistant said after it. */}
        <div className="flex w-full justify-end md:opacity-0 group-hover/message:opacity-100 transition-opacity duration-300">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="message-copy-button"
                variant="ghost"
                size="icon"
                className={cn("size-3! p-4!")}
                onClick={() => copy(part.text)}
              >
                {copied ? <Check /> : <Copy />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("Common.copy")}</TooltipContent>
          </Tooltip>
          {isLast && !readonly && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    data-testid="message-edit-button"
                    variant="ghost"
                    size="icon"
                    className="size-3! p-4!"
                    onClick={() => setMode("edit")}
                  >
                    <Pencil />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {t("Common.edit")}
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    disabled={isDeleting}
                    onClick={deleteMessage}
                    variant="ghost"
                    size="icon"
                    className="size-3! p-4! hover:text-destructive"
                  >
                    {isDeleting ? (
                      <Loader className="animate-spin" />
                    ) : (
                      <Trash2 />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="text-destructive" side="bottom">
                  {t("Common.deleteMessage")}
                </TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
        <div ref={ref} className="min-w-0" />
      </div>
    );
  },
  (prev, next) => {
    if (prev.part.text != next.part.text) return false;
    if (prev.isError != next.isError) return false;
    if (prev.isLast != next.isLast) return false;
    if (prev.status != next.status) return false;
    if (prev.message.id != next.message.id) return false;
    if (!equal(prev.part, next.part)) return false;
    return true;
  },
);
UserMessagePart.displayName = "UserMessagePart";
