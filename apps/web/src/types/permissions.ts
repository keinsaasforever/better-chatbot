export const RESOURCES = {
  WORKFLOW: "workflow",
  AGENT: "agent",
  MCP: "mcp",
  CHAT: "chat",
  TEMPORARY_CHAT: "temporaryChat",
} as const;

export type Resource = (typeof RESOURCES)[keyof typeof RESOURCES];

export const PERMISSION_TYPES = {
  CREATE: "create",
  VIEW: "view",
  UPDATE: "update",
  DELETE: "delete",
  SHARE: "share",
  USE: "use",
  LIST: "list",
} as const;

export type PermissionType =
  (typeof PERMISSION_TYPES)[keyof typeof PERMISSION_TYPES];
