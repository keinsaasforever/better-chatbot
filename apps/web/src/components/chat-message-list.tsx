"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { Loader } from "lucide-react";
import { Button } from "ui/button";
import { PreviewMessage } from "./message";

type Props = {
  messages: UIMessage[];
  status: UseChatHelpers<UIMessage>["status"];
  isLoading: boolean;
  setMessages: UseChatHelpers<UIMessage>["setMessages"];
  sendMessage: UseChatHelpers<UIMessage>["sendMessage"];
  threadId?: string;
  projectId?: string;
  addToolResult?: UseChatHelpers<UIMessage>["addToolResult"];
  addToolApprovalResponse?: UseChatHelpers<UIMessage>["addToolApprovalResponse"];
  messageClassName?: (message: UIMessage, isLastMessage: boolean) => string;
  hasMoreOlder?: boolean;
  isLoadingOlder?: boolean;
  onLoadOlder?: () => void;
};

/** Shared message list for the useChat-backed variants (main + temporary).
 * Keyed by message.id so mid-list mutations (e.g. onError rollback) reconcile
 * correctly; the load-older button is opt-in via props. */
export function ChatMessageList({
  messages,
  status,
  isLoading,
  setMessages,
  sendMessage,
  threadId,
  projectId,
  addToolResult,
  addToolApprovalResponse,
  messageClassName,
  hasMoreOlder,
  isLoadingOlder,
  onLoadOlder,
}: Props) {
  return (
    <>
      {hasMoreOlder && onLoadOlder && (
        <div className="w-full mx-auto max-w-3xl px-4 sm:px-6 flex justify-center py-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={isLoadingOlder}
            onClick={onLoadOlder}
            className="text-muted-foreground"
          >
            {isLoadingOlder ? (
              <Loader className="size-4 animate-spin" />
            ) : (
              "Load older messages"
            )}
          </Button>
        </div>
      )}
      {messages.map((message, index) => {
        const isLastMessage = messages.length - 1 === index;
        return (
          <PreviewMessage
            key={message.id}
            threadId={threadId}
            projectId={projectId}
            messageIndex={index}
            prevMessage={messages[index - 1]}
            message={message}
            status={status}
            addToolResult={addToolResult}
            addToolApprovalResponse={addToolApprovalResponse}
            isLoading={isLoading}
            isLastMessage={isLastMessage}
            setMessages={setMessages}
            sendMessage={sendMessage}
            className={messageClassName?.(message, isLastMessage)}
          />
        );
      })}
    </>
  );
}
