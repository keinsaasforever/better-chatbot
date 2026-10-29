import type { UseChatHelpers } from "@ai-sdk/react";
import { type UIMessage, getToolName, isToolUIPart } from "ai";

export type PendingToolCall = {
  toolName: string;
  toolCallId: string;
};

/**
 * The tool call a thread is currently blocked on: the last part of the last
 * assistant message is a tool invocation that never produced an output, so the
 * model cannot take another turn until the UI supplies one (plan approval,
 * requested input, manual tool confirmation).
 */
export function findPendingToolCall(
  messages: UIMessage[],
  status: UseChatHelpers<UIMessage>["status"],
): PendingToolCall | null {
  if (status != "ready") return null;
  const lastMessage = messages.at(-1);
  if (lastMessage?.role != "assistant") return null;
  const lastPart = lastMessage.parts.at(-1);
  if (!lastPart) return null;
  if (!isToolUIPart(lastPart)) return null;
  if (lastPart.state.startsWith("output")) return null;
  return {
    toolName: getToolName(lastPart),
    toolCallId: lastPart.toolCallId,
  };
}

/** Plain text of an outgoing user message, ignoring attachment/preview parts. */
export function extractSendMessageText(
  message: Parameters<UseChatHelpers<UIMessage>["sendMessage"]>[0],
): string {
  if (!message || typeof message !== "object") return "";
  const parts = "parts" in message ? message.parts : undefined;
  if (!Array.isArray(parts)) return "";
  return parts
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "text" &&
        typeof (part as { text?: unknown }).text === "string" &&
        !(part as { ingestionPreview?: unknown }).ingestionPreview,
    )
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Output injected for a pending tool call when the user answers in the chat (or
 * comments on a plan) instead of using the card's buttons. Shaped like the
 * other HITL rejections so existing tools keep reading `approved`/`rejected`,
 * with the free-text answer attached for the model to act on.
 */
export function buildAnsweredInChatOutput(userMessage: string) {
  return {
    approved: false,
    rejected: true,
    answeredInChat: true,
    userMessage,
    message:
      "The user replied in the chat instead of using this tool's UI. Treat their message as the answer and do not wait on this tool.",
  };
}
