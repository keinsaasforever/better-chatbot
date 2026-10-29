export type AgentAlertKind =
  | "complete"
  | "needs_approval"
  | "needs_input"
  | "error";

export type ResolvedNotificationPrefs = {
  desktopEnabled: boolean;
  onlyWhenAway: boolean;
  hideTaskDetails: boolean;
  weeklyEngagementEnabled: boolean;
};

export type AgentAlertPayload = {
  kind: AgentAlertKind;
  threadId?: string;
  title?: string;
  body?: string;
  url?: string;
};
