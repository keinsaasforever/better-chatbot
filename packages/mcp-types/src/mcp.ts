import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Tool } from "ai";
import { z } from "zod";
import { tag } from "./tag";

// Local equivalent of the app's global PartialBy — packages cannot rely on
// apps/web ambient types.
type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export const MCPRemoteConfigZodSchema = z.object({
  url: z.string().url().describe("The URL of the remote MCP endpoint"),
  headers: z.record(z.string(), z.string()).optional(),
});

export const MCPStdioConfigZodSchema = z.object({
  command: z.string().min(1).describe("The command to run"),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export const AllowedMCPServerZodSchema = z.object({
  tools: z.array(z.string()),
  // resources: z.array(z.string()).optional(),
});

// Canonical visibility across agents, workflows, and MCP. MCP servers are only
// public/private, so their schema narrows this by excluding "readonly".
export const VisibilitySchema = z.enum(["public", "private", "readonly"]);
export const VisibilityZodSchema = VisibilitySchema.exclude(["readonly"]);

export type AllowedMCPServer = z.infer<typeof AllowedMCPServerZodSchema>;
export type Visibility = z.infer<typeof VisibilityZodSchema>;

export type MCPRemoteConfig = z.infer<typeof MCPRemoteConfigZodSchema>;
export type MCPStdioConfig = z.infer<typeof MCPStdioConfigZodSchema>;

export type MCPServerConfig = MCPRemoteConfig | MCPStdioConfig;

export type MCPToolInfo = {
  name: string;
  description: string;
  inputSchema?: {
    type?: any;
    properties?: Record<string, any>;
    required?: string[];
  };
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
};

export type MCPServerInfo = {
  id: string;
  name: string;
  config: MCPServerConfig;
  visibility: "public" | "private";
  error?: unknown;
  enabled: boolean;
  userId: string;
  status: "connected" | "disconnected" | "loading" | "authorizing";
  toolInfo: MCPToolInfo[];
  createdAt?: Date | string;
  updatedAt?: Date | string;
  userName?: string | null;
  userAvatar?: string | null;
  description?: string; // For ShareableCard compatibility
  icon?: {
    value?: string;
    style?: {
      backgroundColor?: string;
    };
  };
};

export type McpServerInsert = {
  name: string;
  config: MCPServerConfig;
  id?: string;
  userId: string;
  organizationId?: string | null;
  visibility?: "public" | "private";
};
export type McpServerSelect = {
  name: string;
  config: MCPServerConfig;
  id: string;
  userId: string;
  organizationId?: string | null;
  visibility: "public" | "private";
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type VercelAIMcpTool = Tool & {
  _mcpServerName: string;
  _mcpServerId: string;
  _originToolName: string;
  _readOnlyHint: boolean;
};

export const VercelAIMcpToolTag = tag<VercelAIMcpTool>("mcp");

export interface MCPRepository {
  save(server: McpServerInsert): Promise<McpServerSelect>;
  insert(server: McpServerInsert): Promise<McpServerSelect>;
  selectById(id: string): Promise<McpServerSelect | null>;
  selectByServerName(name: string): Promise<McpServerSelect | null>;
  selectAll(): Promise<McpServerSelect[]>;
  // activeOrganizationId gates the shared ("public") branch: only servers in
  // the caller's active org are returned. Null/undefined => owner-only.
  selectAllForUser(
    userId: string,
    activeOrganizationId?: string | null,
  ): Promise<McpServerSelect[]>;
  deleteById(id: string): Promise<void>;
  existsByServerName(name: string): Promise<boolean>;
  checkAccess(
    id: string,
    userId: string,
    destructive?: boolean,
    activeOrganizationId?: string | null,
  ): Promise<boolean>;
  updateVisibility(id: string, visibility: "public" | "private"): Promise<void>;
}

export const McpToolCustomizationZodSchema = z.object({
  toolName: z.string().min(1),
  mcpServerId: z.string().min(1),
  prompt: z.string().max(1000).optional().nullable(),
});

export type McpToolCustomization = {
  id: string;
  userId: string;
  toolName: string;
  mcpServerId: string;
  prompt?: string | null;
};

export type McpToolCustomizationRepository = {
  select(key: {
    userId: string;
    mcpServerId: string;
    toolName: string;
  }): Promise<McpToolCustomization | null>;
  selectByUserIdAndMcpServerId: (key: {
    userId: string;
    mcpServerId: string;
  }) => Promise<McpToolCustomization[]>;
  selectByUserId: (
    userId: string,
  ) => Promise<(McpToolCustomization & { serverName: string })[]>;
  upsertToolCustomization: (
    data: PartialBy<McpToolCustomization, "id">,
  ) => Promise<McpToolCustomization>;
  deleteToolCustomization: (key: {
    userId: string;
    mcpServerId: string;
    toolName: string;
  }) => Promise<void>;
};

export const McpServerCustomizationZodSchema = z.object({
  mcpServerId: z.string().min(1),
  prompt: z.string().max(3000).optional().nullable(),
});

export type McpServerCustomization = {
  id: string;
  userId: string;
  mcpServerId: string;
  prompt?: string | null;
};

export type McpServerCustomizationRepository = {
  selectByUserIdAndMcpServerId: (key: {
    userId: string;
    mcpServerId: string;
  }) => Promise<(McpServerCustomization & { serverName: string }) | null>;
  selectByUserId: (
    userId: string,
  ) => Promise<(McpServerCustomization & { serverName: string })[]>;
  upsertMcpServerCustomization: (
    data: PartialBy<McpServerCustomization, "id">,
  ) => Promise<McpServerCustomization>;
  deleteMcpServerCustomizationByMcpServerIdAndUserId: (key: {
    mcpServerId: string;
    userId: string;
  }) => Promise<void>;
};

export type McpServerCustomizationsPrompt = {
  name: string;
  id: string;
  prompt?: string;
  tools?: {
    [toolName: string]: string;
  };
};

const TextContent = z.object({
  type: z.literal("text"),
  text: z.string(),
  _meta: z.object({}).passthrough().optional(),
});

const ImageContent = z.object({
  type: z.literal("image"),
  data: z.string(),
  mimeType: z.string(),
  _meta: z.object({}).passthrough().optional(),
});

const AudioContent = z.object({
  type: z.literal("audio"),
  data: z.string(),
  mimeType: z.string(),
  _meta: z.object({}).passthrough().optional(),
});

const ResourceLinkContent = z.object({
  type: z.literal("resource_link"),
  name: z.string(),
  title: z.string().optional(),
  uri: z.string(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
  _meta: z.object({}).passthrough().optional(),
});

const ResourceText = z.object({
  uri: z.string(),
  mimeType: z.string().optional(),
  _meta: z.object({}).passthrough().optional(),
  text: z.string(),
});

const ResourceBlob = z.object({
  uri: z.string(),
  mimeType: z.string().optional(),
  _meta: z.object({}).passthrough().optional(),
  blob: z.string(),
});

const ResourceContent = z.object({
  type: z.literal("resource"),
  resource: z.union([ResourceText, ResourceBlob]),
  _meta: z.object({}).passthrough().optional(),
});

const ContentUnion = z.union([
  TextContent,
  ImageContent,
  AudioContent,
  ResourceLinkContent,
  ResourceContent,
]);

export const CallToolResultSchema = z.object({
  _meta: z.object({}).passthrough().optional(),
  content: z.array(ContentUnion).default([]),
  structuredContent: z.object({}).passthrough().optional(),
  isError: z.boolean().optional(),
});

export type CallToolResult = z.infer<typeof CallToolResultSchema>;

export type McpOAuthSession = {
  id: string;
  mcpServerId: string;
  serverUrl: string;
  clientInfo?: OAuthClientInformationFull;
  tokens?: OAuthTokens | null;
  codeVerifier?: string;
  state?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type McpOAuthRepository = {
  // 1. Query methods

  // Get session with valid tokens (authenticated)
  getAuthenticatedSession(
    mcpServerId: string,
  ): Promise<McpOAuthSession | undefined>;

  // Get session by OAuth state (for callback handling)
  getSessionByState(state: string): Promise<McpOAuthSession | undefined>;

  // 2. Create/Update methods

  // Create new OAuth session
  createSession(
    mcpServerId: string,
    data: Partial<McpOAuthSession>,
  ): Promise<McpOAuthSession>;

  // Update existing session by state
  updateSessionByState(
    state: string,
    data: Partial<McpOAuthSession>,
  ): Promise<McpOAuthSession>;

  // Save tokens and cleanup incomplete sessions
  saveTokensAndCleanup(
    state: string,
    mcpServerId: string,
    data: Partial<McpOAuthSession>,
  ): Promise<McpOAuthSession>;

  // Explicitly persist SQL NULL; ORM updates intentionally ignore undefined.
  clearTokens(state: string): Promise<McpOAuthSession>;

  // Serialize refresh-token rotation across Navigator instances.
  acquireRefreshLock(lockKey: string): Promise<() => Promise<void>>;

  // Delete a session by its OAuth state
  deleteByState(state: string): Promise<void>;
};
