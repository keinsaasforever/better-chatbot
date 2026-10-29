"use client";

import { useEffect, useRef } from "react";
import type { UIMessage } from "ai";
import { getToolName, isToolUIPart } from "ai";
import { maybeNotifyAgentAlert } from "@/lib/agent-alerts/maybe-notify-agent-alert";

const APPROVAL_TOOL_NAMES = new Set([
  "proposeEmail",
  "askForPlanApproval",
  "requestInput",
]);

function findPendingApproval(messages: UIMessage[]): {
  toolCallId: string;
  toolName: string;
} | null {
  const lastMessage = messages.at(-1);
  if (lastMessage?.role !== "assistant") return null;

  for (const part of lastMessage.parts) {
    if (!isToolUIPart(part)) continue;
    const toolName = getToolName(part);
    if (!APPROVAL_TOOL_NAMES.has(toolName)) continue;
    if (
      part.state === "input-available" ||
      part.state === "approval-requested"
    ) {
      return { toolCallId: part.toolCallId, toolName };
    }
  }

  return null;
}

export function useAgentAlertNotifications({
  threadId,
  messages,
  status,
}: {
  threadId: string;
  messages: UIMessage[];
  status: "submitted" | "streaming" | "ready" | "error";
}) {
  const prevStatusRef = useRef(status);
  const notifiedApprovalRef = useRef<string | null>(null);

  useEffect(() => {
    notifiedApprovalRef.current = null;
  }, [threadId]);

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status;

    if (
      (prevStatus === "streaming" || prevStatus === "submitted") &&
      status === "ready"
    ) {
      maybeNotifyAgentAlert({
        kind: "complete",
        threadId,
      });
    }

    if (prevStatus !== "error" && status === "error") {
      maybeNotifyAgentAlert({
        kind: "error",
        threadId,
      });
    }
  }, [status, threadId]);

  useEffect(() => {
    const pending = findPendingApproval(messages);
    if (!pending) return;

    const key = `${threadId}:${pending.toolCallId}`;
    if (notifiedApprovalRef.current === key) return;
    notifiedApprovalRef.current = key;

    maybeNotifyAgentAlert({
      kind:
        pending.toolName === "requestInput" ? "needs_input" : "needs_approval",
      threadId,
    });
  }, [messages, threadId]);
}
