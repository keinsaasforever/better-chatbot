"use client";

import { type UIMessage, isToolUIPart } from "ai";
import equal from "lib/equal";
import { memo, useEffect, useMemo, useState } from "react";

import { appStore } from "@/app/store";
import type { RecoveryState } from "@/hooks/use-run-recovery";
import type { UseChatHelpers } from "@ai-sdk/react";
import { ChatMetadata } from "app-types/chat";
import { openUsageLimitDialog } from "lib/billing/require-credits";
import { isCreditsExhaustedError } from "lib/chat/credits-exhausted";
import { isNetworkError } from "lib/chat/network-error";
import { collectMessageArtifacts } from "lib/code-runner/artifact-links";
import { cn, truncateString } from "lib/utils";
import {
  ChevronDown,
  ChevronUp,
  Loader,
  TriangleAlertIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "ui/button";
import { MessageArtifactsContext } from "./message-artifacts-context";
import {
  AssistMessagePart,
  AttachmentMessagePart,
  FileMessagePart,
  ReasoningPart,
  SourceDocumentMessagePart,
  ToolMessagePart,
  UserMessagePart,
} from "./message-parts";
import { ToolPartGroup } from "./message-parts/tool-part-group";
import { buildMessageDisplayItems } from "./message-parts/tool-part-grouping";

interface Props {
  message: UIMessage;
  prevMessage?: UIMessage;
  threadId?: string;
  projectId?: string;
  isLoading?: boolean;
  isLastMessage?: boolean;
  setMessages?: UseChatHelpers<UIMessage>["setMessages"];
  sendMessage?: UseChatHelpers<UIMessage>["sendMessage"];
  className?: string;
  addToolResult?: UseChatHelpers<UIMessage>["addToolResult"];
  addToolApprovalResponse?: UseChatHelpers<UIMessage>["addToolApprovalResponse"];
  messageIndex?: number;
  status?: UseChatHelpers<UIMessage>["status"];
  readonly?: boolean;
}

const PurePreviewMessage = ({
  message,
  prevMessage,
  readonly,
  threadId,
  projectId,
  isLoading,
  isLastMessage,
  status,
  className,
  setMessages,
  addToolResult,
  addToolApprovalResponse,
  messageIndex,
  sendMessage,
}: Props) => {
  const isUserMessage = useMemo(() => message.role === "user", [message.role]);
  const partsForDisplay = useMemo(
    () =>
      message.parts.filter(
        (part) => !(part.type === "text" && (part as any).ingestionPreview),
      ),
    [message.parts],
  );

  // A tool call awaiting manual approval must never be hidden inside a
  // collapsed group — it is the only thing the user can act on.
  const manualToolConfirmIndex = useMemo(() => {
    if (readonly || !isLoading || !isLastMessage) return undefined;
    if ((message.metadata as ChatMetadata)?.toolChoice !== "manual")
      return undefined;
    const lastIndex = partsForDisplay.length - 1;
    const lastPart = partsForDisplay[lastIndex];
    return lastPart &&
      isToolUIPart(lastPart) &&
      lastPart.state === "input-available"
      ? lastIndex
      : undefined;
  }, [readonly, isLoading, isLastMessage, message.metadata, partsForDisplay]);

  const displayItems = useMemo(
    () =>
      buildMessageDisplayItems(partsForDisplay, {
        pinnedIndex: manualToolConfirmIndex,
      }),
    [partsForDisplay, manualToolConfirmIndex],
  );

  // Generated files in this message, so a markdown link the model wrote to one
  // (sandbox:/home/user/x.xlsx) resolves to the real download. The provider
  // value is keyed on a content signature, not the array, so every link in
  // the message does not re-render on each stream tick.
  const collected = useMemo(
    () => collectMessageArtifacts(partsForDisplay),
    [partsForDisplay],
  );
  const messageArtifacts = useMemo(
    () => collected.artifacts,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [collected.signature],
  );

  if (message.role == "system") {
    return null; // system message is not shown
  }
  if (!partsForDisplay.length) return null;

  const lastPartIndex = partsForDisplay.length - 1;

  const renderPart = (
    part: (typeof partsForDisplay)[number],
    index: number,
  ) => {
    const key = `message-${messageIndex}-part-${part.type}-${index}`;
    const isLastPart = index === lastPartIndex;

    if (part.type === "reasoning") {
      return (
        <ReasoningPart
          key={key}
          readonly={readonly}
          reasoningText={part.text}
          isThinking={isLastPart && isLastMessage && isLoading}
        />
      );
    }

    if (isUserMessage && part.type === "text" && part.text) {
      return (
        <UserMessagePart
          key={key}
          status={status}
          part={part}
          readonly={readonly}
          isLast={isLastPart}
          message={message}
          setMessages={setMessages}
          sendMessage={sendMessage}
        />
      );
    }

    if (part.type === "text" && !isUserMessage) {
      return (
        <AssistMessagePart
          threadId={threadId}
          projectId={projectId}
          isLast={isLastMessage && isLastPart}
          isLoading={isLoading}
          key={key}
          readonly={readonly}
          part={part}
          prevMessage={prevMessage}
          showActions={isLastMessage ? isLastPart && !isLoading : isLastPart}
          message={message}
          setMessages={setMessages}
          sendMessage={sendMessage}
        />
      );
    }

    if (isToolUIPart(part) && part.type !== "dynamic-tool") {
      const isLast = isLastMessage && isLastPart;
      const isManualToolInvocation = index === manualToolConfirmIndex;
      return (
        <ToolMessagePart
          projectId={projectId}
          threadId={threadId}
          isLast={isLast}
          readonly={readonly}
          messageId={message.id}
          isManualToolInvocation={isManualToolInvocation}
          showActions={
            !readonly && (isLastMessage ? isLastPart && !isLoading : isLastPart)
          }
          addToolResult={addToolResult}
          addToolApprovalResponse={addToolApprovalResponse}
          chatStatus={status}
          runStatus={(message.metadata as ChatMetadata)?.runStatus}
          key={key}
          part={part as any}
          setMessages={setMessages}
        />
      );
    } else if (part.type === "step-start") {
      return null;
    } else if (part.type === "file") {
      return (
        <FileMessagePart key={key} part={part} isUserMessage={isUserMessage} />
      );
    } else if ((part as any).type === "source-url") {
      // Every non-image upload lands here. The chip adapts one of our own
      // storage objects into the artifact panel and the app download route,
      // and falls back to the plain link card for anything else.
      return (
        <AttachmentMessagePart
          key={key}
          part={part as any}
          isUserMessage={isUserMessage}
          messageId={message.id}
          readonly={readonly}
        />
      );
    } else if ((part as any).type === "source-document") {
      return (
        <SourceDocumentMessagePart
          key={key}
          part={part as any}
          isUserMessage={isUserMessage}
        />
      );
    } else {
      return <div key={key}> unknown part {part.type}</div>;
    }
  };

  return (
    <MessageArtifactsContext.Provider value={messageArtifacts}>
      <div className="w-full min-w-0 mx-auto max-w-3xl px-4 sm:px-6 group/message">
        <div
          className={cn(
            // `min-w-0` on both flex boxes: without it their automatic minimum
            // size is the content's, so one wide part (diagram/table/code) pushes
            // the message — and with it the whole page — past the viewport.
            "flex gap-4 w-full min-w-0 group-data-[role=user]/message:ml-auto group-data-[role=user]/message:max-w-2xl",
            className,
          )}
        >
          <div className="flex flex-col gap-4 w-full min-w-0">
            {displayItems.map((item) => {
              if (item.kind === "part") {
                return renderPart(item.part, item.index);
              }
              return (
                <ToolPartGroup
                  key={`message-${messageIndex}-tool-group-${item.index}`}
                  keyPrefix={`message-${messageIndex}-part`}
                  parts={item.parts}
                  messageId={message.id}
                  threadId={threadId}
                  projectId={projectId}
                  readonly={readonly}
                  isLoading={isLoading}
                  isLastMessage={isLastMessage}
                  lastPartIndex={lastPartIndex}
                  addToolResult={addToolResult}
                  addToolApprovalResponse={addToolApprovalResponse}
                  chatStatus={status}
                  runStatus={(message.metadata as ChatMetadata)?.runStatus}
                  setMessages={setMessages}
                />
              );
            })}
          </div>
        </div>
      </div>
    </MessageArtifactsContext.Provider>
  );
};

export const PreviewMessage = memo(
  PurePreviewMessage,
  function equalMessage(prevProps: Props, nextProps: Props) {
    if (prevProps.message.id !== nextProps.message.id) return false;

    if (prevProps.isLoading !== nextProps.isLoading) return false;

    if (prevProps.isLastMessage !== nextProps.isLastMessage) return false;

    if (prevProps.className !== nextProps.className) return false;
    if (prevProps.status !== nextProps.status) return false;
    if (prevProps.threadId !== nextProps.threadId) return false;

    if (nextProps.isLoading && nextProps.isLastMessage) return false;

    if (!equal(prevProps.message.metadata, nextProps.message.metadata))
      return false;

    if (prevProps.message.parts.length !== nextProps.message.parts.length) {
      return false;
    }
    if (!equal(prevProps.message.parts, nextProps.message.parts)) {
      return false;
    }

    return true;
  },
);

export const ErrorMessage = ({
  error,
  onRetry,
  recovery,
}: {
  error: Error;
  onRetry?: () => void;
  /** Set while the chat is looking for the answer the server may already
   * hold; Retry is pointless (and disabled) until that settles. */
  recovery?: RecoveryState;
  message?: UIMessage;
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const maxLength = 200;
  const t = useTranslations();
  // A connection torn down by the browser (a frozen iOS tab, a dropped
  // network) reports itself as "Load failed" / "Failed to fetch" — the
  // browser's own wording, meaningless to the user and, on a persisted
  // thread, usually not even a lost answer. Show a translated notice for
  // those and keep the raw message for genuine server errors. The detail is
  // still logged.
  const isConnectionError = isNetworkError(error);
  useEffect(() => {
    if (isConnectionError) console.warn("Chat connection error:", error);
  }, [isConnectionError, error]);
  // The authoritative out-of-credits signal: the server refused with 402, so
  // whatever the client had seeded was stale (or the user had dismissed the
  // modal). Show translated copy instead of the raw JSON body, and re-open the
  // modal. `useChatCore` builds a fresh Error per failure, so the `error` dep
  // makes a second refusal re-open a modal the user dismissed in between.
  const isCreditsError = isCreditsExhaustedError(error);
  useEffect(() => {
    if (isCreditsError) openUsageLimitDialog();
  }, [isCreditsError, error]);
  // Same distinction the modal makes: "pro" is a repeatable prepaid pack, so a
  // workspace already on it is told to buy more, not to upgrade to it.
  const hasProPlan = appStore((state) => state.usageLimit?.hasProPlan === true);
  const errorText = isConnectionError
    ? t("Chat.connectionInterrupted")
    : isCreditsError
      ? hasProPlan
        ? t("Chat.creditsExhaustedHasPro")
        : t("Chat.creditsExhausted")
      : error.message;
  return (
    <div className="w-full mx-auto max-w-3xl px-4 sm:px-6 animate-in fade-in mt-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-4 px-2 opacity-70">
          <div className="flex items-start gap-3">
            <div className="p-1.5 bg-muted rounded-sm">
              <TriangleAlertIcon className="h-3.5 w-3.5 text-destructive" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-sm mb-2">{t("Chat.Error")}</p>
              <div className="text-sm text-muted-foreground">
                <div className="whitespace-pre-wrap">
                  {isExpanded
                    ? errorText
                    : truncateString(errorText, maxLength)}
                </div>
                {errorText.length > maxLength && (
                  <Button
                    onClick={() => setIsExpanded(!isExpanded)}
                    variant={"ghost"}
                    className="h-auto p-1 text-xs mt-2"
                    size={"sm"}
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="h-3 w-3 mr-1" />
                        {t("Common.showLess")}
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3 w-3 mr-1" />
                        {t("Common.showMore")}
                      </>
                    )}
                  </Button>
                )}
                <p className="text-xs text-muted-foreground mt-3 italic">
                  {t("Chat.thisMessageWasNotSavedPleaseTryTheChatAgain")}
                </p>
                {recovery && (
                  <p className="text-xs text-muted-foreground mt-2 flex items-center gap-2">
                    <Loader className="h-3 w-3 animate-spin" />
                    {recovery === "running"
                      ? t("Chat.answerStillRunning")
                      : t("Chat.recoveringAnswer")}
                  </p>
                )}
                {onRetry && (
                  <Button
                    className="mt-3"
                    onClick={onRetry}
                    size="sm"
                    variant="outline"
                    disabled={Boolean(recovery)}
                  >
                    {t("Chat.retry")}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
