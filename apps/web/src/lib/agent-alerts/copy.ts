import type {
  AgentAlertKind,
  AgentAlertPayload,
  ResolvedNotificationPrefs,
} from "./types";

const GENERIC_TITLE = "An agent needs you";

export function buildAgentAlertCopy(
  opts: Pick<AgentAlertPayload, "kind" | "title">,
  prefs: ResolvedNotificationPrefs,
): { title: string; body: string; actionLabel: string } {
  if (prefs.hideTaskDetails) {
    return {
      title: GENERIC_TITLE,
      body: getGenericBody(opts.kind),
      actionLabel: getActionLabel(opts.kind),
    };
  }

  const title = opts.title?.trim() || getDefaultTitle(opts.kind);
  return {
    title,
    body: getDefaultBody(opts.kind),
    actionLabel: getActionLabel(opts.kind),
  };
}

function getGenericBody(kind: AgentAlertKind): string {
  switch (kind) {
    case "complete":
      return "Your agent finished its task.";
    case "needs_approval":
      return "Your agent is waiting for your approval.";
    case "needs_input":
      return "Your agent needs more information from you.";
    case "error":
      return "Your agent encountered an issue.";
  }
}

function getDefaultTitle(kind: AgentAlertKind): string {
  switch (kind) {
    case "complete":
      return "Agent finished";
    case "needs_approval":
      return "Approval needed";
    case "needs_input":
      return "Input needed";
    case "error":
      return "Agent needs attention";
  }
}

function getDefaultBody(kind: AgentAlertKind): string {
  switch (kind) {
    case "complete":
      return "The response is ready to review.";
    case "needs_approval":
      return "Review and approve to continue.";
    case "needs_input":
      return "Provide the requested details to continue.";
    case "error":
      return "Open the chat to see what went wrong.";
  }
}

function getActionLabel(kind: AgentAlertKind): string {
  switch (kind) {
    case "complete":
      return "View";
    case "needs_approval":
      return "Review";
    case "needs_input":
      return "Respond";
    case "error":
      return "Open";
  }
}

export function getAgentAlertToastId(
  threadId: string | undefined,
  kind: AgentAlertKind,
): string {
  return `agent-alert:${threadId ?? "global"}:${kind}`;
}

export function getChatPath(threadId?: string): string {
  return threadId ? `/chat/${threadId}` : "/";
}
