import type { ModelCapability, ModelRoutingProfile } from "@/types/model";
import { TipTapMentionJsonContent } from "@/types/util";
import { UIMessage } from "ai";
import { Agent, AgentKnowledgeBaseBinding } from "app-types/agent";
import { ChatMetadata } from "app-types/chat";
import { MCPServerConfig } from "app-types/mcp";
import type {
  ProblemReportContext,
  ProblemReportScreenshot,
} from "app-types/problem-report";
import { Skill } from "app-types/skill";
import { UserPreferences } from "app-types/user";
import { DBEdge, DBNode, DBWorkflow } from "app-types/workflow";
import { isNotNull, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  json,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
  vector,
} from "drizzle-orm/pg-core";

export const ChatThreadTable = pgTable(
  "chat_thread",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    title: text("title").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => ProjectTable.id, {
      onDelete: "set null",
    }),
    // Knowledge sources attached from the composer. Same binding shape as an
    // agent's `instructions.knowledgeBases`; the ids are references only, so
    // access is re-checked at retrieval time.
    knowledgeBases: jsonb("knowledge_bases")
      .notNull()
      .default([])
      .$type<AgentKnowledgeBaseBinding[]>(),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("chat_thread_project_idx").on(table.projectId),
    index("chat_thread_user_id_idx").on(table.userId),
  ],
);

export const ChatMessageTable = pgTable(
  "chat_message",
  {
    id: text("id").primaryKey().notNull(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => ChatThreadTable.id, { onDelete: "cascade" }),
    role: text("role").notNull().$type<UIMessage["role"]>(),
    parts: json("parts").notNull().array().$type<UIMessage["parts"]>(),
    metadata: jsonb("metadata").$type<ChatMetadata>(),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("chat_message_thread_created_at_idx").on(
      table.threadId,
      table.createdAt,
    ),
  ],
);

export const AgentTable = pgTable(
  "agent",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    icon: json("icon").$type<Agent["icon"]>(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    // Org that may see this agent when shared (public/readonly). Nullable: an
    // org-less row fails closed — the shared-read predicate can't match NULL, so
    // it stays owner-only and never leaks cross-tenant.
    organizationId: text("organization_id").references(
      () => OrganizationTable.id,
      { onDelete: "cascade" },
    ),
    instructions: json("instructions").$type<Agent["instructions"]>(),
    visibility: varchar("visibility", {
      enum: ["public", "private", "readonly"],
    })
      .notNull()
      .default("private"),
    /** Identifies which preset template this agent was created from (nullable for user-created agents) */
    presetId: varchar("preset_id", { length: 100 }),
    // Pinned chat model as "provider/model"; NULL inherits the chat's selected
    // model / routing default. When set it wins over both — see api/chat.
    model: varchar("model", { length: 120 }),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("agent_organization_id_idx").on(table.organizationId)],
);

export const SkillTable = pgTable(
  "skill",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    // skills.sh skill id (e.g. "vercel-react-best-practices").
    slug: text("slug").notNull(),
    // "owner/repo" the skill was imported from.
    source: text("source").notNull(),
    // The fetched SKILL.md instruction body (frontmatter stripped, size-capped).
    content: text("content").notNull(),
    icon: json("icon").$type<Skill["icon"]>(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    // Org that may see this skill when shared (public/readonly). Nullable: an
    // org-less row fails closed — the shared-read predicate can't match NULL, so
    // it stays owner-only and never leaks cross-tenant.
    organizationId: text("organization_id").references(
      () => OrganizationTable.id,
      { onDelete: "cascade" },
    ),
    visibility: varchar("visibility", {
      enum: ["public", "private", "readonly"],
    })
      .notNull()
      .default("private"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("skill_organization_id_idx").on(table.organizationId),
    index("skill_user_id_idx").on(table.userId),
  ],
);

export const ScheduledTaskTable = pgTable(
  "scheduled_task",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),

    // What to run
    taskType: varchar("task_type", { enum: ["agent"] }).notNull(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => AgentTable.id, { onDelete: "cascade" }),
    // Name of this schedule within its agent (unique per agent). Lets a single
    // agent own multiple named schedules; also the filename a future
    // file/directory backend would use (schedules/<key>.json).
    key: varchar("key", { length: 64 }).notNull().default("default"),

    // Basic config
    name: text("name").notNull(),
    description: text("description"),
    cronExpression: text("cron_expression").notNull(),
    timezone: text("timezone").notNull().default("UTC"),

    // The message to send to the agent
    inputPrompt: text("input_prompt"),

    // Per-task opt-in for driving a browser with nobody watching. Defaults off
    // and is not ceremony: headful browser time bills at 128 credits/second
    // (docs/kernel-browser-billing.md), so a tool that bound by default on
    // every schedule would be a billing incident waiting for a slow run.
    browserAutomationEnabled: boolean("browser_automation_enabled")
      .notNull()
      .default(false),
    // Which `browser_credential` aliases this task may sign in with. The model
    // never widens this; a human picks it in the schedule dialog.
    browserCredentialAliases: text("browser_credential_aliases").array(),

    // Tracking
    enabled: boolean("enabled").default(true),
    lastRunAt: timestamp("last_run_at"),
    lastRunStatus: varchar("last_run_status", {
      enum: ["success", "failure", "timeout"],
    }),
    lastRunError: text("last_run_error"),
    lastChatThreadId: text("last_chat_thread_id"),
    // The cron occurrence a run last claimed. Distinct from lastRunAt (the
    // completion time): due-detection floors on this so a run that overruns its
    // interval does not skip the occurrences it stepped over.
    lastSlotAt: timestamp("last_slot_at"),
    // Next occurrence, persisted so the checker can filter on it instead of
    // recomputing cron math for every enabled row each minute.
    nextRunAt: timestamp("next_run_at"),
    runCount: integer("run_count").default(0),
    successCount: integer("success_count").default(0),
    failureCount: integer("failure_count").default(0),

    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("scheduled_task_user_idx").on(table.userId),
    index("scheduled_task_agent_idx").on(table.agentId),
    index("scheduled_task_enabled_idx").on(table.enabled),
    uniqueIndex("scheduled_task_agent_key_idx").on(table.agentId, table.key),
    index("scheduled_task_due_idx").on(table.enabled, table.nextRunAt),
  ],
);

export type ScheduledTaskEntity = typeof ScheduledTaskTable.$inferSelect;

export const BookmarkTable = pgTable(
  "bookmark",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull(),
    itemType: varchar("item_type", {
      enum: ["agent", "workflow", "mcp"],
    }).notNull(),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique().on(table.userId, table.itemId, table.itemType),
    index("bookmark_user_id_idx").on(table.userId),
    index("bookmark_item_idx").on(table.itemId, table.itemType),
  ],
);

export const McpServerTable = pgTable(
  "mcp_server",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    name: text("name").notNull(),
    config: json("config").notNull().$type<MCPServerConfig>(),
    enabled: boolean("enabled").notNull().default(true),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    // Org that may see this server when shared (public). Nullable: org-less rows
    // fail closed (owner-only) — the shared-read predicate can't match NULL.
    organizationId: text("organization_id").references(
      () => OrganizationTable.id,
      { onDelete: "cascade" },
    ),
    visibility: varchar("visibility", {
      enum: ["public", "private"],
    })
      .notNull()
      .default("private"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("mcp_server_organization_id_idx").on(table.organizationId)],
);

export const UserTable = pgTable("user", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  password: text("password"),
  image: text("image"),
  preferences: json("preferences").default({}).$type<UserPreferences>(),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  banned: boolean("banned"),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  role: text("role").notNull().default("user"),
});

// Role tables removed - using Better Auth's built-in role system
// Roles are now managed via the 'role' field on UserTable

export const SessionTable = pgTable("session", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: uuid("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  // Admin plugin field (from better-auth generated schema)
  impersonatedBy: text("impersonated_by"),
  // Organization plugin field - tracks active organization context
  activeOrganizationId: text("active_organization_id"),
});

// ============================================================
// Organization Plugin Tables (Better Auth organization plugin)
// ============================================================

export const OrganizationTable = pgTable("organization", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const MemberTable = pgTable(
  "member",
  {
    id: text("id").primaryKey().notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => OrganizationTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("member_organization_id_idx").on(table.organizationId),
    index("member_user_id_idx").on(table.userId),
  ],
);

export const InvitationTable = pgTable("invitation", {
  id: text("id").primaryKey().notNull(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => OrganizationTable.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role"),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at").notNull(),
  inviterId: text("inviter_id").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export type OrganizationEntity = typeof OrganizationTable.$inferSelect;
export type MemberEntity = typeof MemberTable.$inferSelect;
export type InvitationEntity = typeof InvitationTable.$inferSelect;

export const AccountTable = pgTable("account", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const VerificationTable = pgTable("verification", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").$defaultFn(
    () => /* @__PURE__ */ new Date(),
  ),
  updatedAt: timestamp("updated_at").$defaultFn(
    () => /* @__PURE__ */ new Date(),
  ),
});

// Better Auth `apiKey` plugin (@better-auth/api-key). Property names are the
// plugin's field names, which the drizzle adapter maps by key. `key` holds the
// SHA-256 hash, never the secret; `start` is its first characters for display.
// Keys reference a user (`references: "user"`); the organization a key acts in
// lives in `metadata.organizationId` and is re-checked against membership on
// every use (lib/navigator-tools/api-keys.ts). Migration 0065.
export const ApiKeyTable = pgTable(
  "apikey",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    configId: text("config_id").notNull().default("default"),
    name: text("name"),
    start: text("start"),
    referenceId: uuid("reference_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    prefix: text("prefix"),
    key: text("key").notNull(),
    refillInterval: integer("refill_interval"),
    refillAmount: integer("refill_amount"),
    lastRefillAt: timestamp("last_refill_at"),
    enabled: boolean("enabled").default(true),
    rateLimitEnabled: boolean("rate_limit_enabled").default(true),
    rateLimitTimeWindow: integer("rate_limit_time_window"),
    rateLimitMax: integer("rate_limit_max"),
    requestCount: integer("request_count").default(0),
    remaining: integer("remaining"),
    lastRequest: timestamp("last_request"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    permissions: text("permissions"),
    metadata: text("metadata"),
  },
  (table) => [
    uniqueIndex("apikey_key_idx").on(table.key),
    index("apikey_reference_id_idx").on(table.referenceId),
    index("apikey_config_id_idx").on(table.configId),
  ],
);

export type ApiKeyEntity = typeof ApiKeyTable.$inferSelect;

// Tool customization table for per-user additional instructions
export const McpToolCustomizationTable = pgTable(
  "mcp_server_tool_custom_instructions",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    mcpServerId: uuid("mcp_server_id")
      .notNull()
      .references(() => McpServerTable.id, { onDelete: "cascade" }),
    prompt: text("prompt"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [unique().on(table.userId, table.toolName, table.mcpServerId)],
);

export const McpServerCustomizationTable = pgTable(
  "mcp_server_custom_instructions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    mcpServerId: uuid("mcp_server_id")
      .notNull()
      .references(() => McpServerTable.id, { onDelete: "cascade" }),
    prompt: text("prompt"),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [unique().on(table.userId, table.mcpServerId)],
);

export const WorkflowTable = pgTable(
  "workflow",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    version: text("version").notNull().default("0.1.0"),
    name: text("name").notNull(),
    icon: json("icon").$type<DBWorkflow["icon"]>(),
    description: text("description"),
    isPublished: boolean("is_published").notNull().default(false),
    visibility: varchar("visibility", {
      enum: ["public", "private", "readonly"],
    })
      .notNull()
      .default("private"),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    // Org that may see this workflow when shared (public/readonly). Nullable:
    // org-less rows fail closed (owner-only) — the shared-read predicate can't
    // match NULL.
    organizationId: text("organization_id").references(
      () => OrganizationTable.id,
      { onDelete: "cascade" },
    ),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("workflow_organization_id_idx").on(table.organizationId)],
);

export const WorkflowNodeDataTable = pgTable(
  "workflow_node",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    version: text("version").notNull().default("0.1.0"),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => WorkflowTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    uiConfig: json("ui_config").$type<DBNode["uiConfig"]>().default({}),
    nodeConfig: json("node_config")
      .$type<Partial<DBNode["nodeConfig"]>>()
      .default({}),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("workflow_node_kind_idx").on(t.kind)],
);

export const WorkflowEdgeTable = pgTable("workflow_edge", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  version: text("version").notNull().default("0.1.0"),
  workflowId: uuid("workflow_id")
    .notNull()
    .references(() => WorkflowTable.id, { onDelete: "cascade" }),
  source: uuid("source")
    .notNull()
    .references(() => WorkflowNodeDataTable.id, { onDelete: "cascade" }),
  target: uuid("target")
    .notNull()
    .references(() => WorkflowNodeDataTable.id, { onDelete: "cascade" }),
  uiConfig: json("ui_config").$type<DBEdge["uiConfig"]>().default({}),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const ProjectTable = pgTable(
  "project",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    organizationId: text("organization_id")
      .notNull()
      .references(() => OrganizationTable.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    goal: text("goal"),
    embeddingModel: text("embedding_model")
      .notNull()
      .default("text-embedding-3-small"),
    // Agentset namespace fields
    agentsetNamespaceId: text("agentset_namespace_id"),
    agentsetEmbeddingProfile: text("agentset_embedding_profile")
      .notNull()
      .default("agentset-managed"),
    agentsetEmbeddingConfig: jsonb("agentset_embedding_config").$type<
      Record<string, unknown>
    >(),
    retrievalBackend: varchar("retrieval_backend", {
      enum: ["local", "agentset", "hybrid"],
    })
      .notNull()
      .default("hybrid"),
    memoryEnabled: boolean("memory_enabled").notNull().default(true),
    voiceEnabled: boolean("voice_enabled").notNull().default(true),
    // Project system prompt — drives project-context runs (widget population,
    // project brain) and which Composio toolkits are relevant to this project.
    systemPrompt: text("system_prompt"),
    onboardingCompletedAt: timestamp("onboarding_completed_at"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("project_organization_idx").on(table.organizationId),
    index("project_owner_idx").on(table.ownerUserId),
  ],
);

export const McpOAuthSessionTable = pgTable(
  "mcp_oauth_session",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    mcpServerId: uuid("mcp_server_id")
      .notNull()
      .references(() => McpServerTable.id, { onDelete: "cascade" }),
    serverUrl: text("server_url").notNull(),
    clientInfo: json("client_info"),
    tokens: json("tokens"),
    codeVerifier: text("code_verifier"),
    state: text("state").unique(), // OAuth state parameter for current flow (unique for security)
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("mcp_oauth_session_server_id_idx").on(t.mcpServerId),
    index("mcp_oauth_session_state_idx").on(t.state),
    // Partial index for sessions with tokens for better performance
    index("mcp_oauth_session_tokens_idx")
      .on(t.mcpServerId)
      .where(isNotNull(t.tokens)),
  ],
);

export type McpServerEntity = typeof McpServerTable.$inferSelect;
export type ChatThreadEntity = typeof ChatThreadTable.$inferSelect;
export type ChatMessageEntity = typeof ChatMessageTable.$inferSelect;

export type AgentEntity = typeof AgentTable.$inferSelect;
export type UserEntity = typeof UserTable.$inferSelect;
export type SessionEntity = typeof SessionTable.$inferSelect;

export type ToolCustomizationEntity =
  typeof McpToolCustomizationTable.$inferSelect;
export type McpServerCustomizationEntity =
  typeof McpServerCustomizationTable.$inferSelect;

export const ChatExportTable = pgTable("chat_export", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  title: text("title").notNull(),
  exporterId: uuid("exporter_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  originalThreadId: uuid("original_thread_id"),
  messages: json("messages").notNull().$type<
    Array<{
      id: string;
      role: UIMessage["role"];
      parts: UIMessage["parts"];
      metadata?: ChatMetadata;
    }>
  >(),
  exportedAt: timestamp("exported_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  expiresAt: timestamp("expires_at"),
});

/**
 * A published snapshot of a page built in a sandbox.
 *
 * Sandboxes are ephemeral and their URL is derived from the sandbox ID, so a
 * killed sandbox 502s forever and the ID cannot be recreated. Publishing
 * therefore stores the rendered HTML rather than a sandbox reference: the page
 * outlives the sandbox and costs nothing at rest.
 *
 * Rows are append-only. A slug resolves to its newest non-revoked row, so the
 * URL is stable while the author keeps editing and republishing, and a bad
 * publish can be rolled back by revoking it. `revokedAt` is the kill switch
 * `chat_export` never had — there, un-sharing means deleting the row.
 *
 * Access is capability-by-unguessable-slug, matching `chat_export`: no session
 * is required to read one, so nothing confidential belongs here.
 */
export const PublishedPageTable = pgTable(
  "published_page",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    slug: text("slug").notNull(),
    version: integer("version").notNull().default(1),
    title: text("title").notNull(),
    html: text("html").notNull(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    organizationId: text("organization_id"),
    threadId: uuid("thread_id"),
    publishedAt: timestamp("published_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    expiresAt: timestamp("expires_at"),
    revokedAt: timestamp("revoked_at"),
  },
  (table) => [
    unique("published_page_slug_version_unique").on(table.slug, table.version),
    index("published_page_slug_idx").on(table.slug),
    index("published_page_owner_idx").on(table.ownerId),
  ],
);

/**
 * Registry of E2B preview sandboxes.
 *
 * There was no server-side record of a sandbox at all: the ID survived only
 * inside a chat message's tool-result JSON and in React state. That made three
 * things impossible — reusing a thread's sandbox instead of creating a new one
 * per tool call, checking ownership without a round-trip to E2B, and reaping
 * sandboxes whose browser tab died before it could pause them.
 *
 * `state` mirrors E2B's own lifecycle. A paused sandbox is free and retained
 * indefinitely, so rows stay useful long after the sandbox stops running;
 * `killed` is terminal and means the ID can never be resurrected.
 *
 * `threadId` is `set null` rather than `cascade` **on purpose**: deleting a
 * thread does not delete the sandbox at E2B, and cascading would destroy the
 * only record of something that is still billing — creating exactly the orphan
 * this table exists to catch.
 */
export const SandboxSessionTable = pgTable(
  "sandbox_session",
  {
    sandboxId: text("sandbox_id").primaryKey().notNull(),
    threadId: uuid("thread_id").references(() => ChatThreadTable.id, {
      onDelete: "set null",
    }),
    toolCallId: text("tool_call_id"),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    organizationId: text("organization_id"),
    template: text("template").notNull(),
    port: integer("port").notNull(),
    url: text("url").notNull(),
    state: varchar("state", { enum: ["running", "paused", "killed"] })
      .notNull()
      .default("running"),
    /** sha256 of the install command, so an unchanged reuse can skip it. */
    installCommandHash: text("install_command_hash"),
    lastActiveAt: timestamp("last_active_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("sandbox_session_thread_template_idx").on(
      table.threadId,
      table.template,
      table.state,
    ),
    index("sandbox_session_user_idx").on(table.userId),
    index("sandbox_session_state_active_idx").on(
      table.state,
      table.lastActiveAt,
    ),
  ],
);

export const ChatExportCommentTable = pgTable("chat_export_comment", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  exportId: uuid("export_id")
    .notNull()
    .references(() => ChatExportTable.id, { onDelete: "cascade" }),
  authorId: uuid("author_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id").references(() => ChatExportCommentTable.id, {
    onDelete: "cascade",
  }),
  content: json("content").notNull().$type<TipTapMentionJsonContent>(),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export type ProjectEntity = typeof ProjectTable.$inferSelect;
export type BookmarkEntity = typeof BookmarkTable.$inferSelect;

// Models table for rich metadata and pricing
export const ModelsTable = pgTable("models", {
  model: text("model").primaryKey().notNull(),
  developer: text("developer").notNull(),
  country: text("country"),
  text: boolean("text").notNull().default(false),
  vision: boolean("vision").notNull().default(false),
  audio: boolean("audio").notNull().default(false),
  hiddenGem: boolean("hiddenGem").notNull().default(false),
  caution: boolean("caution").notNull().default(false),
  notRecommended: boolean("notRecommended").notNull().default(false),
  cheapAlternative: boolean("cheapAlternative").notNull().default(false),
  speed: boolean("speed").notNull().default(false),
  thinking: boolean("thinking").notNull().default(false),
  maxPerformance: boolean("maxPerformance").notNull().default(false),
  inputPriceUsd: numeric("input_price_usd", { precision: 20, scale: 10 }),
  outputPriceUsd: numeric("output_price_usd", { precision: 20, scale: 10 }),
  contextTokens: integer("context_tokens"),
  description: text("description"),
  routingDescription: text("routing_description"),
  routingProfile: json("routing_profile").$type<ModelRoutingProfile>(),
  capabilities: json("capabilities").$type<ModelCapability[]>(),
  qualityScore: numeric("quality_score", { precision: 3, scale: 2 }),
  latencyTier: text("latency_tier"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export type ModelEntity = typeof ModelsTable.$inferSelect;

// Logical models remain the product-facing catalog. Deployments describe a
// concrete callable provider path, including retention and pricing data used by
// the deterministic router.
export const ModelDeploymentTable = pgTable(
  "model_deployment",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    modelId: text("model_id")
      .notNull()
      .references(() => ModelsTable.model, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerModelId: text("provider_model_id").notNull(),
    region: text("region"),
    dataRetention: text("data_retention").notNull().default("unknown"),
    evidenceUrl: text("evidence_url"),
    retentionVerifiedAt: timestamp("retention_verified_at"),
    inputPriceMicrosPerMillion: bigint("input_price_micros_per_million", {
      mode: "number",
    })
      .notNull()
      .default(0),
    outputPriceMicrosPerMillion: bigint("output_price_micros_per_million", {
      mode: "number",
    })
      .notNull()
      .default(0),
    contextTokens: integer("context_tokens").notNull().default(0),
    supportsTools: boolean("supports_tools").notNull().default(false),
    supportsVision: boolean("supports_vision").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique("model_deployment_provider_model_unique").on(
      table.provider,
      table.providerModelId,
    ),
    index("model_deployment_model_idx").on(table.modelId),
    index("model_deployment_active_idx").on(table.active),
  ],
);

export const ModelTaskProfileTable = pgTable(
  "model_task_profile",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    modelId: text("model_id")
      .notNull()
      .references(() => ModelsTable.model, { onDelete: "cascade" }),
    taskKey: text("task_key").notNull(),
    score: integer("score").notNull(),
    tieBreakPriority: integer("tie_break_priority").notNull().default(0),
    bestTaskDescription: text("best_task_description").notNull(),
    limitations: text("limitations"),
    evidence: text("evidence"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique("model_task_profile_model_task_unique").on(
      table.modelId,
      table.taskKey,
    ),
    index("model_task_profile_task_idx").on(table.taskKey),
  ],
);

export const OrganizationAiPolicyTable = pgTable("organization_ai_policy", {
  organizationId: text("organization_id")
    .primaryKey()
    .notNull()
    .references(() => OrganizationTable.id, { onDelete: "cascade" }),
  automaticRoutingEnabled: boolean("automatic_routing_enabled")
    .notNull()
    .default(true),
  /**
   * Org opt-in for Kernel browser automation. Defaults off: this is the one
   * tool that drives a real browser against arbitrary sites, and it is metered
   * per browser-second.
   */
  browserAutomationEnabled: boolean("browser_automation_enabled")
    .notNull()
    .default(false),
  /**
   * Separate opt-in for browser automation on runs with nobody watching
   * (scheduled agents). Distinct from the flag above on purpose: "a person may
   * drive a browser from chat" and "a robot may drive one at 3am, sign in, and
   * bill browser-seconds unsupervised" are different decisions, and an org can
   * reasonably want the first without the second.
   */
  browserAutomationUnattendedEnabled: boolean(
    "browser_automation_unattended_enabled",
  )
    .notNull()
    .default(false),
  maxInputPriceMicrosPerMillion: bigint("max_input_price_micros_per_million", {
    mode: "number",
  }),
  maxOutputPriceMicrosPerMillion: bigint(
    "max_output_price_micros_per_million",
    { mode: "number" },
  ),
  maxEstimatedRequestMicros: bigint("max_estimated_request_micros", {
    mode: "number",
  }),
  allowedRegions: text("allowed_regions").array(),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * A website the org's agents may sign into, and the saved browser session for
 * it.
 *
 * Holds NO credential material. The username, password and any TOTP seed live
 * in one Scaleway Secret Manager secret; this row keeps only the pointer
 * (`externalSecretId`), the same shape `navigator_connected_tools` already
 * uses. `usernameHint` is a masked display string computed at write time, never
 * the real value.
 *
 * Org-scoped rather than user-scoped: a scheduled task runs as its owner but
 * inside the agent's organization, and a company's portal login belongs to the
 * company. Every repository method filters on `organizationId`.
 */
export const BrowserCredentialTable = pgTable(
  "browser_credential",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => OrganizationTable.id, { onDelete: "cascade" }),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    /** Short handle the agent refers to this site by, e.g. `emta`. */
    alias: varchar("alias", { length: 64 }).notNull(),
    label: text("label"),
    /**
     * Registrable domain this credential is bound to. The origin check in
     * `lib/kernel/playwright-execute-tool` refuses to substitute the value
     * anywhere else, which is what keeps a prompt-injected page from
     * harvesting it.
     */
    domain: text("domain").notNull(),
    /** Narrower than `domain` when a site needs it, e.g. one path prefix. */
    allowedUrlPrefix: text("allowed_url_prefix"),
    /** Masked, for display only, e.g. `p***@keinsaas.com`. */
    usernameHint: text("username_hint"),
    /** Scaleway secret UUID. Never returned to a client. */
    externalSecretId: text("external_secret_id"),
    /** Kernel profile holding the saved cookies for this site. */
    kernelProfileId: text("kernel_profile_id"),
    kernelProfileName: text("kernel_profile_name"),
    profileSavedAt: timestamp("profile_saved_at"),
    lastUsedAt: timestamp("last_used_at"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("browser_credential_org_alias_idx").on(
      table.organizationId,
      table.alias,
    ),
    index("browser_credential_org_idx").on(table.organizationId),
  ],
);

export type BrowserCredentialEntity =
  typeof BrowserCredentialTable.$inferSelect;

export const OrganizationModelAccessTable = pgTable(
  "organization_model_access",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => OrganizationTable.id, { onDelete: "cascade" }),
    deploymentId: uuid("deployment_id")
      .notNull()
      .references(() => ModelDeploymentTable.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    inputPriceMicrosPerMillionOverride: bigint(
      "input_price_micros_per_million_override",
      { mode: "number" },
    ),
    outputPriceMicrosPerMillionOverride: bigint(
      "output_price_micros_per_million_override",
      { mode: "number" },
    ),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique("organization_model_access_org_deployment_unique").on(
      table.organizationId,
      table.deploymentId,
    ),
    index("organization_model_access_org_idx").on(table.organizationId),
  ],
);

export const MemberAiPolicyTable = pgTable("member_ai_policy", {
  memberId: text("member_id")
    .primaryKey()
    .notNull()
    .references(() => MemberTable.id, { onDelete: "cascade" }),
  monthlyCapMicros: bigint("monthly_cap_micros", { mode: "number" }),
  hardStop: boolean("hard_stop").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const MemberAiUsagePeriodTable = pgTable(
  "member_ai_usage_period",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    memberId: text("member_id")
      .notNull()
      .references(() => MemberTable.id, { onDelete: "cascade" }),
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),
    finalizedMicros: bigint("finalized_micros", { mode: "number" })
      .notNull()
      .default(0),
    reservedMicros: bigint("reserved_micros", { mode: "number" })
      .notNull()
      .default(0),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique("member_ai_usage_period_member_start_unique").on(
      table.memberId,
      table.periodStart,
    ),
    index("member_ai_usage_period_member_idx").on(table.memberId),
  ],
);

export const MemberAiReservationTable = pgTable(
  "member_ai_reservation",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    usagePeriodId: uuid("usage_period_id")
      .notNull()
      .references(() => MemberAiUsagePeriodTable.id, { onDelete: "cascade" }),
    deploymentId: uuid("deployment_id")
      .notNull()
      .references(() => ModelDeploymentTable.id, { onDelete: "restrict" }),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    estimateMicros: bigint("estimate_micros", { mode: "number" }).notNull(),
    actualMicros: bigint("actual_micros", { mode: "number" }),
    status: text("status").notNull().default("reserved"),
    expiresAt: timestamp("expires_at").notNull(),
    finalizedAt: timestamp("finalized_at"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("member_ai_reservation_period_idx").on(table.usagePeriodId),
    index("member_ai_reservation_status_idx").on(table.status),
  ],
);

export const ModelRouteAuditTable = pgTable(
  "model_route_audit",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    organizationId: text("organization_id").references(
      () => OrganizationTable.id,
      {
        onDelete: "set null",
      },
    ),
    memberId: text("member_id").references(() => MemberTable.id, {
      onDelete: "set null",
    }),
    deploymentId: uuid("deployment_id")
      .notNull()
      .references(() => ModelDeploymentTable.id, { onDelete: "restrict" }),
    taskKey: text("task_key").notNull(),
    taskScore: integer("task_score").notNull(),
    selector: text("selector").notNull().default("deterministic"),
    reasonCode: text("reason_code").notNull(),
    policyVersion: text("policy_version").notNull().default("mvp-v2"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("model_route_audit_member_idx").on(table.memberId),
    index("model_route_audit_created_idx").on(table.createdAt),
  ],
);

export const DocumentTable = pgTable("document", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  storageKey: text("storage_key").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  hash: text("hash"),
  // Agentset document fields
  sourceProvider: varchar("source_provider", {
    enum: ["supabase", "agentset"],
  })
    .notNull()
    .default("supabase"),
  sourceKey: text("source_key"),
  agentsetUploadKey: text("agentset_upload_key"),
  agentsetDocumentId: text("agentset_document_id"),
  agentsetIngestJobId: text("agentset_ingest_job_id"),
  agentsetStatus: varchar("agentset_status", {
    enum: ["pending", "processing", "completed", "failed", "skipped"],
  })
    .notNull()
    .default("pending"),
  agentsetError: text("agentset_error"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const DocumentChunkTable = pgTable(
  "document_chunk",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => DocumentTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    metadata: json("metadata"), // page number, etc.
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("document_chunk_document_id_idx").on(table.documentId),
    index("document_chunk_project_id_idx").on(table.projectId),
    index("document_chunk_user_id_idx").on(table.userId),
  ],
);

export const DocumentEmbeddingTable = pgTable(
  "document_embedding",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    chunkId: uuid("chunk_id")
      .notNull()
      .references(() => DocumentChunkTable.id, { onDelete: "cascade" }),
    embedding: vector("embedding", { dimensions: 1536 }), // Default to OpenAI small (1536)
    model: text("model").notNull(), // e.g., 'text-embedding-3-small'
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("document_embedding_chunk_id_idx").on(table.chunkId),
    index("embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
  ],
);

export type DocumentEntity = typeof DocumentTable.$inferSelect;
export type DocumentChunkEntity = typeof DocumentChunkTable.$inferSelect;
export type DocumentEmbeddingEntity =
  typeof DocumentEmbeddingTable.$inferSelect;

// ============================================================
// Document Edits (tracked changes from AI editing)
// ============================================================

export const DocumentEditTable = pgTable(
  "document_edit",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => DocumentTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    changeId: text("change_id").notNull(),
    delWId: text("del_w_id"),
    insWId: text("ins_w_id"),
    deletedText: text("deleted_text").notNull().default(""),
    insertedText: text("inserted_text").notNull().default(""),
    contextBefore: text("context_before").notNull().default(""),
    contextAfter: text("context_after").notNull().default(""),
    reason: text("reason"),
    status: varchar("status", { enum: ["pending", "accepted", "rejected"] })
      .notNull()
      .default("pending"),
    editedStorageKey: text("edited_storage_key"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("document_edit_document_id_idx").on(table.documentId),
    index("document_edit_user_id_idx").on(table.userId),
    index("document_edit_change_id_idx").on(table.changeId),
  ],
);

export type DocumentEditEntity = typeof DocumentEditTable.$inferSelect;

// ============================================================
// Tabular Reviews
// ============================================================

export const TabularReviewTable = pgTable(
  "tabular_review",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    columns: json("columns").notNull().$type<
      {
        id: string;
        label: string;
        type: string;
        preset?: string;
        prompt?: string;
      }[]
    >(),
    status: varchar("status", {
      enum: ["pending", "generating", "done", "error"],
    })
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("tabular_review_user_id_idx").on(table.userId)],
);

export const TabularReviewDocumentTable = pgTable(
  "tabular_review_document",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => TabularReviewTable.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => DocumentTable.id, { onDelete: "cascade" }),
    rowIndex: integer("row_index").notNull().default(0),
  },
  (table) => [
    index("tabular_review_doc_review_idx").on(table.reviewId),
    unique("tabular_review_doc_unique").on(table.reviewId, table.documentId),
  ],
);

export const TabularCellTable = pgTable(
  "tabular_cell",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => TabularReviewTable.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => DocumentTable.id, { onDelete: "cascade" }),
    columnId: text("column_id").notNull(),
    value: text("value"),
    status: varchar("status", {
      enum: ["pending", "generating", "done", "error"],
    })
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("tabular_cell_review_id_idx").on(table.reviewId),
    index("tabular_cell_document_id_idx").on(table.documentId),
    unique("tabular_cell_unique").on(
      table.reviewId,
      table.documentId,
      table.columnId,
    ),
  ],
);

export type TabularReviewEntity = typeof TabularReviewTable.$inferSelect;
export type TabularReviewDocumentEntity =
  typeof TabularReviewDocumentTable.$inferSelect;
export type TabularCellEntity = typeof TabularCellTable.$inferSelect;

// ============================================================
// Workflow Generator Tables (navigator_*)
// ============================================================

export const NavigatorWorkflowTable = pgTable(
  "navigator_workflows",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    orgId: text("org_id").notNull(),
    createdBy: text("created_by").notNull(),
    displayName: text("display_name").notNull(),
    triggerHandle: text("trigger_handle").notNull(),
    hostingType: text("hosting_type").notNull(),
    executionUrl: text("execution_url"),
    /** Scaleway Serverless Containers — used with GetContainer API for live monitoring */
    scalewayContainerId: text("scaleway_container_id"),
    scalewayRegion: text("scaleway_region"),
    githubRepo: text("github_repo"),
    githubRepoUrl: text("github_repo_url"),
    githubRepoPath: text("github_repo_path"),
    // AI Pass 1 output
    diagramMermaid: text("diagram_mermaid"),
    toolList: jsonb("tool_list"),
    followUpQuestions: jsonb("follow_up_questions"),
    // Source input from user upload/description
    userInputRaw: text("user_input_raw"),
    userInputFileName: text("user_input_file_name"),
    userInputDescription: text("user_input_description"),
    // GitHub repo or web page the user pointed the generator at. The analyze
    // job fetches it server-side; the commit pins which revision was read.
    sourceUrl: text("source_url"),
    sourceCommitSha: text("source_commit_sha"),
    // Outbound calls found in the source, mapped to verified Composio actions
    // or flagged as custom APIs (see composio-actions.ts).
    integrationCalls: jsonb("integration_calls"),
    // Per-workflow end-user dashboard (served by the workflow's container)
    // and its database on the shared managed Postgres instance.
    dashboardUrl: text("dashboard_url"),
    workflowDbName: text("workflow_db_name"),
    // Enriched process description produced by the analyze step — used by
    // refine as the n8nac search query and the primary context for the AI.
    enhancedDescription: text("enhanced_description"),
    // User Q&A answers from StepAIChat — persisted on every keystroke so the
    // user can close the window and resume with their partial answers intact.
    userAnswers: jsonb("user_answers"),
    // AI Pass 2 output
    refinedDiagramMermaid: text("refined_diagram_mermaid"),
    automationSpec: jsonb("automation_spec"),
    workflowSummary: text("workflow_summary"),
    n8nTemplateMatches: jsonb("n8n_template_matches"),
    analysisSummary: text("analysis_summary"),
    // Wizard resume
    currentStep: integer("current_step").default(1),
    // Billing
    autumnProductId: text("autumn_product_id"),
    paymentStatus: text("payment_status").default("unpaid"),
    planTier: text("plan_tier"),
    // Status
    buildStatus: text("build_status").default("draft"),
    isActive: boolean("is_active").default(false),
    lastDeployedAt: timestamp("last_deployed_at"),
    bitwardenCollectionId: text("bitwarden_collection_id"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("nav_wf_org_id_idx").on(table.orgId),
    index("nav_wf_build_status_idx").on(table.buildStatus),
    index("nav_wf_created_by_idx").on(table.createdBy),
  ],
);

export type NavigatorWorkflowEntity =
  typeof NavigatorWorkflowTable.$inferSelect;

export const NavigatorWorkflowAccessTable = pgTable(
  "navigator_workflow_access",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => NavigatorWorkflowTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    grantedBy: text("granted_by").notNull(),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique().on(table.workflowId, table.userId),
    index("nav_wf_access_wf_idx").on(table.workflowId),
    index("nav_wf_access_user_idx").on(table.userId),
  ],
);

export type NavigatorWorkflowAccessEntity =
  typeof NavigatorWorkflowAccessTable.$inferSelect;

export const NavigatorConnectedToolTable = pgTable(
  "navigator_connected_tools",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    orgId: text("org_id").notNull(),
    workflowId: uuid("workflow_id").references(() => NavigatorWorkflowTable.id),
    toolName: text("tool_name").notNull(),
    authType: text("auth_type"),
    externalSecretId: text("external_secret_id"),
    status: text("status").default("pending"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("nav_connected_tools_org_idx").on(table.orgId),
    unique("nav_connected_tools_unique").on(
      table.orgId,
      table.workflowId,
      table.toolName,
    ),
  ],
);

export type NavigatorConnectedToolEntity =
  typeof NavigatorConnectedToolTable.$inferSelect;

export const NavigatorWorkflowRunTable = pgTable(
  "navigator_workflow_runs",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    workflowId: uuid("workflow_id").references(() => NavigatorWorkflowTable.id),
    orgId: text("org_id").notNull(),
    triggeredBy: text("triggered_by"),
    status: text("status"),
    inputData: jsonb("input_data"),
    outputData: jsonb("output_data"),
    errorLog: text("error_log"),
    startedAt: timestamp("started_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    finishedAt: timestamp("finished_at"),
  },
  (table) => [
    index("nav_wf_runs_wf_idx").on(table.workflowId),
    index("nav_wf_runs_org_idx").on(table.orgId),
  ],
);

export type NavigatorWorkflowRunEntity =
  typeof NavigatorWorkflowRunTable.$inferSelect;

export const NavigatorWorkflowMetricsTable = pgTable(
  "navigator_workflow_metrics",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => NavigatorWorkflowTable.id, { onDelete: "cascade" }),
    orgId: text("org_id").notNull(),
    executionsTotal: integer("executions_total").default(0),
    executions7d: integer("executions_7d").default(0),
    executions24h: integer("executions_24h").default(0),
    recordsProcessedTotal: integer("records_processed_total").default(0),
    avgDurationMs: integer("avg_duration_ms"),
    successRatePct: numeric("success_rate_pct", { precision: 5, scale: 2 }),
    errorRatePct: numeric("error_rate_pct", { precision: 5, scale: 2 }),
    lastRunAt: timestamp("last_run_at"),
    lastRunStatus: text("last_run_status"),
    customKpis: jsonb("custom_kpis"),
    snapshotSource: text("snapshot_source"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("nav_wf_metrics_wf_idx").on(table.workflowId)],
);

export type NavigatorWorkflowMetricsEntity =
  typeof NavigatorWorkflowMetricsTable.$inferSelect;

export const NavigatorChangeRequestTable = pgTable(
  "navigator_change_requests",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => NavigatorWorkflowTable.id, { onDelete: "cascade" }),
    orgId: text("org_id").notNull(),
    submittedBy: text("submitted_by").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    priority: text("priority").default("normal"),
    status: text("status").default("open"),
    adminNotes: text("admin_notes"),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("nav_cr_wf_idx").on(table.workflowId),
    index("nav_cr_org_idx").on(table.orgId),
  ],
);

export type NavigatorChangeRequestEntity =
  typeof NavigatorChangeRequestTable.$inferSelect;

// ============================================================
// Preferred-tools catalog — curated by admins, queried by the
// analyze AI step to recommend the best tool per task category.
// ============================================================

export const NavigatorPreferredToolTable = pgTable(
  "navigator_preferred_tools",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    /** Broad category: "enrichment", "vector_db", "ai_model", "email", etc. */
    category: text("category").notNull(),
    /** The recommended first-choice tool for this category */
    primaryTool: text("primary_tool").notNull(),
    /** Optional fallback or alternative tool */
    secondaryTool: text("secondary_tool"),
    /** Comma-separated keywords matched against the user's process description */
    taskKeywords: text("task_keywords").notNull(),
    /** Composio app slug for OAuth tools, e.g. "fullenrich", "hubspot" */
    composioSlug: text("composio_slug"),
    /** Exact n8n node type string, e.g. "n8n-nodes-base.gmail" */
    n8nNodeType: text("n8n_node_type"),
    /** "oauth2" | "api_key" | "none" */
    authType: text("auth_type"),
    /** Short rationale shown to the AI: when and why to prefer this tool */
    notes: text("notes"),
    /** Lesser-known but powerful tool worth surfacing to users */
    isHiddenGem: boolean("is_hidden_gem").default(false),
    /** Tool can be self-hosted by the customer */
    isSelfHostable: boolean("is_self_hostable").default(false),
    /** Tool offers EU-resident data hosting */
    isEuHosted: boolean("is_eu_hosted").default(false),
    /** Tool is available in the Composio catalog */
    inComposio: boolean("in_composio").default(false),
    /** Tool is available via Autumn billing */
    viaAutumn: boolean("via_autumn").default(false),
    /** Link to official documentation */
    docsUrl: text("docs_url"),
    /** Example n8n workflow snippet or code reference */
    exampleCode: text("example_code"),
    /** Lower = higher priority in search results (1 is highest) */
    priority: integer("priority").default(1),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("nav_pref_tools_category_idx").on(table.category),
    index("nav_pref_tools_active_idx").on(table.isActive),
    unique("nav_pref_tools_unique").on(table.category, table.primaryTool),
  ],
);

export type NavigatorPreferredToolEntity =
  typeof NavigatorPreferredToolTable.$inferSelect;

// ============================================================
// Blog Agent (code-hosted workflow — settings + generated posts)
// ============================================================

/** JSON shape for `blog_agent_settings.settings` — see `lib/blog-agent/types.ts` */
export type BlogAgentSettingsJson = {
  copySystemPrompt: string;
  imageSystemPrompt: string;
  runMode: "autonomous" | "review";
  /** Single Composio toolkit slug for publish output */
  publishToolkitSlug: string | null;
};

export const BlogAgentSettingsTable = pgTable(
  "blog_agent_settings",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    settings: jsonb("settings").notNull().$type<BlogAgentSettingsJson>(),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique("blog_agent_settings_org_user").on(table.orgId, table.userId),
    index("blog_agent_settings_org_idx").on(table.orgId),
  ],
);

export type BlogAgentSettingsEntity =
  typeof BlogAgentSettingsTable.$inferSelect;

export const BlogAgentPostTable = pgTable(
  "blog_agent_posts",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    slug: text("slug"),
    summary: text("summary"),
    imageUrl: text("image_url"),
    status: text("status").notNull().default("draft"),
    /** @deprecated prefer publishToolkitSlug — retained for older rows */
    publishDestinations: jsonb("publish_destinations").$type<string[]>(),
    publishToolkitSlug: text("publish_toolkit_slug"),
    externalUrls: jsonb("external_urls").$type<Record<string, string> | null>(),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("blog_agent_posts_org_idx").on(table.orgId),
    index("blog_agent_posts_created_idx").on(table.createdAt),
  ],
);

export type BlogAgentPostEntity = typeof BlogAgentPostTable.$inferSelect;

// ============================================================
// Sales Agent (code-hosted workflow — settings + CRM config)
// ============================================================

/** JSON shape stored in `sales_agent_settings.settings` */
export type SalesAgentSettingsJson = {
  systemPrompt: string;
  runMode: "autonomous" | "review";
  /** Composio toolkit slug for the CRM (e.g. "hubspot", "salesforce") */
  crmToolkitSlug: string | null;
  /** Composio toolkit slug for outbound comms (e.g. "gmail", "outlook") */
  outboundToolkitSlug: string | null;
};

export const SalesAgentSettingsTable = pgTable(
  "sales_agent_settings",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    settings: jsonb("settings").notNull().$type<SalesAgentSettingsJson>(),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique("sales_agent_settings_org_user").on(table.orgId, table.userId),
    index("sales_agent_settings_org_idx").on(table.orgId),
  ],
);

export type SalesAgentSettingsEntity =
  typeof SalesAgentSettingsTable.$inferSelect;

// ============================================================
// Project Brain Tables (gbrain-style project memory layer)
// ============================================================

export const ProjectBrainPageTable = pgTable(
  "project_brain_page",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    type: varchar("type", {
      enum: [
        "overview",
        "person",
        "organization",
        "course",
        "task",
        "meeting",
        "note",
        "voice",
        "concept",
        "source",
        "decision",
        "document",
        "tool",
        "agent",
        "topic",
      ],
    }).notNull(),
    title: text("title").notNull(),
    compiledTruth: text("compiled_truth").notNull().default(""),
    summary: text("summary"),
    frontmatter: jsonb("frontmatter")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    // Set when the nightly dedupe folded this page into another one. The row
    // stays so old links and citations keep resolving; it is hidden from the
    // graph, retrieval and consolidation via archivedAt.
    mergedIntoPageId: uuid("merged_into_page_id"),
    // Degree + facts + recency + source diversity, recomputed by the dream
    // cycle. Orders the graph and boosts retrieval.
    salience: numeric("salience", { precision: 8, scale: 3 })
      .notNull()
      .default("0"),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique("project_brain_page_project_slug_unique").on(
      table.projectId,
      table.slug,
    ),
    index("project_brain_page_project_idx").on(table.projectId),
    index("project_brain_page_user_idx").on(table.userId),
    index("project_brain_page_project_salience_idx").on(
      table.projectId,
      table.salience,
    ),
  ],
);

export const ProjectBrainContradictionTable = pgTable(
  "project_brain_contradiction",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    pageId: uuid("page_id")
      .notNull()
      .references(() => ProjectBrainPageTable.id, { onDelete: "cascade" }),
    factKey: text("fact_key").notNull(),
    factIdA: uuid("fact_id_a").notNull(),
    factIdB: uuid("fact_id_b").notNull(),
    verdict: varchar("verdict", {
      length: 16,
      enum: ["contradiction", "compatible", "unknown"],
    })
      .notNull()
      .default("unknown"),
    explanation: text("explanation"),
    status: varchar("status", {
      length: 16,
      enum: ["open", "resolved", "dismissed"],
    })
      .notNull()
      .default("open"),
    resolvedByUserId: uuid("resolved_by_user_id").references(
      () => UserTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("project_brain_contradiction_pair_idx").on(
      table.factIdA,
      table.factIdB,
    ),
    index("project_brain_contradiction_project_status_idx").on(
      table.projectId,
      table.status,
    ),
  ],
);

export type ProjectBrainContradictionEntity =
  typeof ProjectBrainContradictionTable.$inferSelect;

export const ProjectBrainEventTable = pgTable(
  "project_brain_event",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    pageId: uuid("page_id").references(() => ProjectBrainPageTable.id, {
      onDelete: "set null",
    }),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    sourceType: varchar("source_type", {
      enum: ["voice", "chat", "document", "manual", "tool"],
    }).notNull(),
    sourceId: text("source_id").notNull(),
    eventDate: timestamp("event_date").notNull(),
    summary: text("summary").notNull(),
    detail: text("detail"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("project_brain_event_project_date_idx").on(
      table.projectId,
      table.eventDate,
    ),
    index("project_brain_event_source_idx").on(
      table.sourceType,
      table.sourceId,
    ),
  ],
);

export const ProjectBrainLinkTable = pgTable(
  "project_brain_link",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    fromPageId: uuid("from_page_id")
      .notNull()
      .references(() => ProjectBrainPageTable.id, { onDelete: "cascade" }),
    toPageId: uuid("to_page_id")
      .notNull()
      .references(() => ProjectBrainPageTable.id, { onDelete: "cascade" }),
    linkType: text("link_type").notNull().default("mentions"),
    context: text("context"),
    confidence: numeric("confidence", { precision: 4, scale: 3 })
      .notNull()
      .default("1"),
    source: varchar("source", {
      enum: ["markdown", "frontmatter", "classifier", "manual"],
    })
      .notNull()
      .default("classifier"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique("project_brain_link_unique").on(
      table.projectId,
      table.fromPageId,
      table.toPageId,
      table.linkType,
    ),
    index("project_brain_link_from_idx").on(table.fromPageId),
    index("project_brain_link_to_idx").on(table.toPageId),
  ],
);

export const VoiceTranscriptTable = pgTable(
  "voice_transcript",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => ProjectTable.id, {
      onDelete: "set null",
    }),
    sessionId: text("session_id").notNull(),
    eventId: text("event_id").notNull(),
    deviceId: text("device_id"),
    text: text("text").notNull(),
    normalizedText: text("normalized_text"),
    language: text("language"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    intent: varchar("intent", {
      enum: [
        "memory",
        "question",
        "command",
        "mixed",
        "unknown",
        "task",
        "workflow",
        "agent",
        "scheduled_agent",
        "note",
      ],
    })
      .notNull()
      .default("unknown"),
    classification: jsonb("classification")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    actionStatus: varchar("action_status", {
      enum: ["stored", "needs_review", "executed", "failed", "ignored"],
    })
      .notNull()
      .default("stored"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique("voice_transcript_user_session_event_unique").on(
      table.userId,
      table.sessionId,
      table.eventId,
    ),
    index("voice_transcript_project_idx").on(table.projectId),
    index("voice_transcript_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
);

export const VoiceSessionTable = pgTable(
  "voice_session",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    organizationId: text("organization_id"),
    billingCustomerId: text("billing_customer_id").notNull(),
    deviceId: uuid("device_id").references(() => VoiceDeviceTable.id, {
      onDelete: "set null",
    }),
    mode: varchar("mode", {
      enum: ["voice_command", "long_capture"],
    })
      .notNull()
      .default("voice_command"),
    status: varchar("status", {
      enum: ["active", "completed", "interrupted"],
    })
      .notNull()
      .default("active"),
    sessionId: text("session_id").notNull(),
    gatewayInstanceId: text("gateway_instance_id"),
    deviceConnectionId: text("device_connection_id"),
    provider: text("provider"),
    startedAt: timestamp("started_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    endedAt: timestamp("ended_at"),
    durationSeconds: integer("duration_seconds"),
    audioSeconds: integer("audio_seconds"),
    billedAssemblyaiSeconds: integer("billed_assemblyai_seconds")
      .notNull()
      .default(0),
    lastAudioAt: timestamp("last_audio_at"),
    lastSegmentAt: timestamp("last_segment_at"),
    lastHeartbeatAt: timestamp("last_heartbeat_at"),
    transcriptText: text("transcript_text"),
    segmentCount: integer("segment_count").notNull().default(0),
    analysisStatus: varchar("analysis_status", {
      enum: ["pending", "running", "completed", "failed", "skipped"],
    })
      .notNull()
      .default("pending"),
    analysisResult: jsonb("analysis_result")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    targetType: varchar("target_type", {
      enum: [
        "note",
        "task_chat",
        "workflow_draft",
        "agent_draft",
        "scheduled_agent",
        "question",
        "long_capture_summary",
      ],
    }),
    targetId: text("target_id"),
    projectId: uuid("project_id").references(() => ProjectTable.id, {
      onDelete: "set null",
    }),
    createdThreadId: text("created_thread_id"),
    createdWorkflowId: text("created_workflow_id"),
    createdAgentId: text("created_agent_id"),
    createdScheduledTaskId: text("created_scheduled_task_id"),
    interruptReason: text("interrupt_reason"),
    finalizeReason: text("finalize_reason"),
    finalizeRequestedAt: timestamp("finalize_requested_at"),
    finalizedAt: timestamp("finalized_at"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique("voice_session_device_session_unique").on(
      table.deviceId,
      table.sessionId,
    ),
    index("voice_session_user_created_idx").on(table.userId, table.startedAt),
    index("voice_session_device_status_idx").on(table.deviceId, table.status),
  ],
);

export const VoiceTranscriptProviderConnectionTable = pgTable(
  "voice_transcript_provider_connection",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    voiceSessionId: uuid("voice_session_id")
      .notNull()
      .references(() => VoiceSessionTable.id, { onDelete: "cascade" }),
    provider: varchar("provider", {
      enum: ["assemblyai"],
    }).notNull(),
    providerConnectionId: text("provider_connection_id").notNull(),
    status: varchar("status", {
      enum: ["active", "closed", "failed"],
    })
      .notNull()
      .default("active"),
    sequenceStart: integer("sequence_start"),
    sequenceEnd: integer("sequence_end"),
    startedAt: timestamp("started_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    endedAt: timestamp("ended_at"),
    closeReason: text("close_reason"),
    lastProviderEventAt: timestamp("last_provider_event_at"),
  },
  (table) => [
    unique("voice_provider_connection_unique").on(
      table.voiceSessionId,
      table.providerConnectionId,
    ),
    index("voice_provider_connection_session_idx").on(
      table.voiceSessionId,
      table.startedAt,
    ),
  ],
);

export const VoiceTranscriptSegmentTable = pgTable(
  "voice_transcript_segment",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    voiceSessionId: uuid("voice_session_id")
      .notNull()
      .references(() => VoiceSessionTable.id, { onDelete: "cascade" }),
    providerConnectionId: uuid("provider_connection_id").references(
      () => VoiceTranscriptProviderConnectionTable.id,
      { onDelete: "set null" },
    ),
    sequenceNumber: integer("sequence_number").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    providerSegmentId: text("provider_segment_id"),
    startMs: integer("start_ms"),
    endMs: integer("end_ms"),
    text: text("text").notNull(),
    isFinal: boolean("is_final").notNull().default(true),
    language: text("language"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    providerPayload: jsonb("provider_payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique("voice_segment_session_sequence_unique").on(
      table.voiceSessionId,
      table.sequenceNumber,
    ),
    unique("voice_segment_idempotency_unique").on(
      table.voiceSessionId,
      table.idempotencyKey,
    ),
    index("voice_segment_session_created_idx").on(
      table.voiceSessionId,
      table.createdAt,
    ),
  ],
);

export const VoiceUsageEventTable = pgTable(
  "voice_usage_event",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    voiceSessionId: uuid("voice_session_id")
      .notNull()
      .references(() => VoiceSessionTable.id, { onDelete: "cascade" }),
    billingCustomerId: text("billing_customer_id").notNull(),
    featureId: text("feature_id").notNull(),
    quantity: integer("quantity").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: varchar("status", {
      enum: ["pending", "tracked", "failed"],
    })
      .notNull()
      .default("pending"),
    error: text("error"),
    trackedAt: timestamp("tracked_at"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique("voice_usage_event_idempotency_unique").on(table.idempotencyKey),
    index("voice_usage_event_session_idx").on(table.voiceSessionId),
  ],
);

export type ProjectBrainPageEntity = typeof ProjectBrainPageTable.$inferSelect;
export type ProjectBrainEventEntity =
  typeof ProjectBrainEventTable.$inferSelect;
export type ProjectBrainLinkEntity = typeof ProjectBrainLinkTable.$inferSelect;
export type VoiceTranscriptEntity = typeof VoiceTranscriptTable.$inferSelect;
export type VoiceSessionEntity = typeof VoiceSessionTable.$inferSelect;
export type VoiceTranscriptSegmentEntity =
  typeof VoiceTranscriptSegmentTable.$inferSelect;

// ============================================================
// Project GBrain Workspace Tables
// ============================================================

export type ProjectBrainSourceSignalsRecord = {
  summary: string;
  status: {
    health: "green" | "yellow" | "red" | "unknown";
    progressPct?: number;
    blockers: string[];
    shortSummary: string;
  };
  todos: Array<{
    title: string;
    status: string;
    priority: string;
    rationale?: string;
    detail?: string;
    dueAt?: string;
    sourceUrl?: string;
  }>;
};

export const ProjectBrainRawSourceTable = pgTable(
  "project_brain_raw_source",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    sourceUserId: uuid("source_user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => ProjectBrainRunTable.id, {
      onDelete: "set null",
    }),
    sourceType: varchar("source_type", {
      enum: [
        "chat",
        "transcript",
        "meeting",
        "document",
        "tool_sync",
        "manual",
        "agent",
        "workflow",
      ],
    }).notNull(),
    sourceRef: text("source_ref").notNull(),
    sourceScope: text("source_scope").notNull(),
    contentHash: text("content_hash").notNull(),
    title: text("title"),
    textContent: text("text_content"),
    summary: text("summary"),
    rawPayload: jsonb("raw_payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    // Per-source summary / status / todos from the extraction step. Read by
    // the project-level consolidation so it never re-parses raw text.
    extractionSignals: jsonb(
      "extraction_signals",
    ).$type<ProjectBrainSourceSignalsRecord | null>(),
    observedAt: timestamp("observed_at").notNull(),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique("project_brain_raw_source_version_unique").on(
      table.projectId,
      table.sourceType,
      table.sourceRef,
      table.contentHash,
    ),
    index("project_brain_raw_source_project_idx").on(table.projectId),
    index("project_brain_raw_source_observed_idx").on(table.observedAt),
  ],
);

export const ProjectBrainPageVersionTable = pgTable(
  "project_brain_page_version",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => ProjectBrainPageTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    compiledTruth: text("compiled_truth").notNull().default(""),
    summary: text("summary"),
    frontmatter: jsonb("frontmatter")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    sourceId: uuid("source_id").references(
      () => ProjectBrainRawSourceTable.id,
      { onDelete: "set null" },
    ),
    snapshotAt: timestamp("snapshot_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("project_brain_page_version_page_idx").on(table.pageId),
    index("project_brain_page_version_project_idx").on(table.projectId),
  ],
);

export const ProjectBrainContentChunkTable = pgTable(
  "project_brain_content_chunk",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    pageId: uuid("page_id").references(() => ProjectBrainPageTable.id, {
      onDelete: "cascade",
    }),
    sourceId: uuid("source_id").references(
      () => ProjectBrainRawSourceTable.id,
      { onDelete: "cascade" },
    ),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    chunkType: varchar("chunk_type", {
      enum: ["compiled_truth", "timeline", "raw_source", "summary"],
    }).notNull(),
    content: text("content").notNull(),
    chunkIndex: integer("chunk_index").notNull().default(0),
    embedding: vector("embedding", { dimensions: 1536 }),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("project_brain_chunk_project_idx").on(table.projectId),
    index("project_brain_chunk_page_idx").on(table.pageId),
    index("project_brain_chunk_source_idx").on(table.sourceId),
    index("project_brain_chunk_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
  ],
);

export const ProjectConnectedToolTable = pgTable(
  "project_connected_tool",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    credentialOwnerUserId: uuid("credential_owner_user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    providerType: varchar("provider_type", {
      enum: ["composio", "mcp"],
    }).notNull(),
    providerRef: text("provider_ref").notNull(),
    connectionRef: text("connection_ref"),
    toolName: text("tool_name").notNull(),
    displayName: text("display_name").notNull(),
    status: varchar("status", {
      enum: ["connected", "needs_auth", "disabled", "error"],
    })
      .notNull()
      .default("connected"),
    syncEnabled: boolean("sync_enabled").notNull().default(true),
    syncConfig: jsonb("sync_config")
      .$type<{ readActionSlugs?: string[] }>()
      .notNull()
      .default({}),
    lastSyncAt: timestamp("last_sync_at"),
    lastSyncError: text("last_sync_error"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique("project_connected_tool_identity_unique").on(
      table.projectId,
      table.providerType,
      table.connectionRef,
      table.toolName,
    ),
    index("project_connected_tool_project_idx").on(table.projectId),
  ],
);

export const ProjectStatusSnapshotTable = pgTable(
  "project_status_snapshot",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    todosHtml: text("todos_html"),
    statusHtml: text("status_html"),
    todosRenderData: jsonb("todos_render_data")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    statusRenderData: jsonb("status_render_data")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    summary: text("summary"),
    health: varchar("health", {
      enum: ["green", "yellow", "red", "unknown"],
    })
      .notNull()
      .default("unknown"),
    // The ingest run that produced this snapshot. Unique where set, so a
    // replayed consolidation step cannot insert a second snapshot.
    runId: uuid("run_id"),
    generatedAt: timestamp("generated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("project_status_snapshot_project_idx").on(table.projectId),
    index("project_status_snapshot_generated_idx").on(table.generatedAt),
    uniqueIndex("project_status_snapshot_run_idx")
      .on(table.runId)
      .where(isNotNull(table.runId)),
  ],
);

export const ProjectTodoTable = pgTable(
  "project_todo",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    // LLM-stable dedupe key: the same task seen in two tools is one row.
    key: varchar("key", { length: 80 }).notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    priority: varchar("priority", {
      length: 16,
      enum: ["low", "normal", "high", "critical"],
    })
      .notNull()
      .default("normal"),
    dueAt: timestamp("due_at"),
    sourceScope: text("source_scope"),
    sourceLabel: text("source_label"),
    sourceUrl: text("source_url"),
    // Owned by the user once set to done/dismissed: a later sync never reopens.
    status: varchar("status", {
      length: 16,
      enum: ["open", "done", "dismissed"],
    })
      .notNull()
      .default("open"),
    notifiedAt: timestamp("notified_at"),
    notifiedRunId: uuid("notified_run_id"),
    lastSeenAt: timestamp("last_seen_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    resolvedAt: timestamp("resolved_at"),
    resolvedByUserId: uuid("resolved_by_user_id").references(
      () => UserTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("project_todo_project_key_idx").on(table.projectId, table.key),
    index("project_todo_project_status_idx").on(table.projectId, table.status),
  ],
);

export type ProjectTodoEntity = typeof ProjectTodoTable.$inferSelect;

export const ProjectMemberTable = pgTable(
  "project_member",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    role: varchar("role", {
      enum: ["owner", "editor", "viewer"],
    })
      .notNull()
      .default("viewer"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique("project_member_unique").on(table.projectId, table.userId),
    index("project_member_project_idx").on(table.projectId),
    index("project_member_user_idx").on(table.userId),
  ],
);

export const ProjectAgentTable = pgTable(
  "project_agent",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => AgentTable.id, { onDelete: "cascade" }),
    addedBy: uuid("added_by").references(() => UserTable.id, {
      onDelete: "set null",
    }),
    status: varchar("status", {
      enum: ["active", "paused"],
    })
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique("project_agent_unique").on(table.projectId, table.agentId),
    index("project_agent_project_idx").on(table.projectId),
  ],
);

export const ProjectWorkflowTable = pgTable(
  "project_workflow",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => WorkflowTable.id, { onDelete: "cascade" }),
    addedBy: uuid("added_by").references(() => UserTable.id, {
      onDelete: "set null",
    }),
    status: varchar("status", {
      enum: ["active", "paused"],
    })
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique("project_workflow_unique").on(table.projectId, table.workflowId),
    index("project_workflow_project_idx").on(table.projectId),
  ],
);

export const ProjectBrainRunTable = pgTable(
  "project_brain_run",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    sourceUserId: uuid("source_user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    connectedToolId: uuid("connected_tool_id").references(
      () => ProjectConnectedToolTable.id,
      { onDelete: "set null" },
    ),
    sourceType: varchar("source_type", {
      enum: [
        "chat",
        "transcript",
        "meeting",
        "document",
        "tool_sync",
        "manual",
        "agent",
        "workflow",
      ],
    }).notNull(),
    sourceRef: text("source_ref").notNull(),
    sourceScope: text("source_scope").notNull(),
    trigger: varchar("trigger", {
      enum: [
        "onboarding",
        "tool_attach",
        "manual_sync",
        "daily_sync",
        "chat_completed",
        "document_ingested",
        "voice_finalized",
        "thread_assigned",
        "rebuild",
      ],
    }).notNull(),
    fullSnapshot: boolean("full_snapshot").notNull().default(true),
    idempotencyKey: text("idempotency_key").notNull(),
    status: varchar("status", {
      enum: ["queued", "running", "succeeded", "partial", "failed", "skipped"],
    })
      .notNull()
      .default("queued"),
    stage: varchar("stage", {
      enum: [
        "queued",
        "loading_source",
        "extracting",
        "persisting",
        "materializing",
        "consolidating",
        "complete",
      ],
    })
      .notNull()
      .default("queued"),
    attempts: integer("attempts").notNull().default(0),
    metrics: jsonb("metrics")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    enqueuedAt: timestamp("enqueued_at"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique("project_brain_run_idempotency_unique").on(
      table.projectId,
      table.idempotencyKey,
    ),
    index("project_brain_run_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
    index("project_brain_run_status_idx").on(table.status),
  ],
);

export const ProjectBrainAliasTable = pgTable(
  "project_brain_alias",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    pageId: uuid("page_id")
      .notNull()
      .references(() => ProjectBrainPageTable.id, {
        onDelete: "cascade",
      }),
    entityType: varchar("entity_type").notNull(),
    alias: text("alias").notNull(),
    normalizedAlias: text("normalized_alias").notNull(),
    source: varchar("source", {
      enum: ["canonical", "extracted", "manual"],
    })
      .notNull()
      .default("extracted"),
    createdBySourceId: uuid("created_by_source_id").references(
      () => ProjectBrainRawSourceTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique("project_brain_alias_identity_unique").on(
      table.projectId,
      table.entityType,
      table.normalizedAlias,
    ),
    index("project_brain_alias_page_idx").on(table.pageId),
  ],
);

export const ProjectBrainFactTable = pgTable(
  "project_brain_fact",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    pageId: uuid("page_id")
      .notNull()
      .references(() => ProjectBrainPageTable.id, {
        onDelete: "cascade",
      }),
    sourceScope: text("source_scope").notNull(),
    factType: varchar("fact_type", {
      enum: ["attribute", "status", "decision", "task", "summary"],
    }).notNull(),
    factKey: text("fact_key").notNull(),
    value: text("value").notNull(),
    valueHash: text("value_hash").notNull(),
    status: varchar("status", {
      enum: ["current", "superseded", "retracted"],
    })
      .notNull()
      .default("current"),
    confidence: numeric("confidence", { precision: 4, scale: 3 })
      .notNull()
      .default("1"),
    firstSourceId: uuid("first_source_id").references(
      () => ProjectBrainRawSourceTable.id,
      { onDelete: "set null" },
    ),
    lastSourceId: uuid("last_source_id").references(
      () => ProjectBrainRawSourceTable.id,
      { onDelete: "set null" },
    ),
    lastRunId: uuid("last_run_id").references(() => ProjectBrainRunTable.id, {
      onDelete: "set null",
    }),
    firstObservedAt: timestamp("first_observed_at").notNull(),
    lastObservedAt: timestamp("last_observed_at").notNull(),
    supersededAt: timestamp("superseded_at"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique("project_brain_fact_value_unique").on(
      table.pageId,
      table.sourceScope,
      table.factKey,
      table.valueHash,
    ),
    index("project_brain_fact_project_status_idx").on(
      table.projectId,
      table.status,
    ),
  ],
);

export const ProjectBrainLinkEvidenceTable = pgTable(
  "project_brain_link_evidence",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    linkId: uuid("link_id")
      .notNull()
      .references(() => ProjectBrainLinkTable.id, {
        onDelete: "cascade",
      }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => ProjectBrainRawSourceTable.id, {
        onDelete: "cascade",
      }),
    runId: uuid("run_id").references(() => ProjectBrainRunTable.id, {
      onDelete: "set null",
    }),
    sourceScope: text("source_scope").notNull(),
    evidenceKey: text("evidence_key").notNull(),
    context: text("context"),
    status: varchar("status", {
      enum: ["current", "retracted"],
    })
      .notNull()
      .default("current"),
    confidence: numeric("confidence", { precision: 4, scale: 3 })
      .notNull()
      .default("1"),
    observedAt: timestamp("observed_at").notNull(),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique("project_brain_link_evidence_unique").on(
      table.linkId,
      table.sourceScope,
      table.evidenceKey,
    ),
  ],
);

export type ProjectBrainRawSourceEntity =
  typeof ProjectBrainRawSourceTable.$inferSelect;
export type ProjectBrainRunEntity = typeof ProjectBrainRunTable.$inferSelect;
export type ProjectBrainPageVersionEntity =
  typeof ProjectBrainPageVersionTable.$inferSelect;
export type ProjectBrainContentChunkEntity =
  typeof ProjectBrainContentChunkTable.$inferSelect;
export type ProjectConnectedToolEntity =
  typeof ProjectConnectedToolTable.$inferSelect;
export type ProjectStatusSnapshotEntity =
  typeof ProjectStatusSnapshotTable.$inferSelect;
export type ProjectMemberEntity = typeof ProjectMemberTable.$inferSelect;
export type ProjectAgentEntity = typeof ProjectAgentTable.$inferSelect;

export const VoiceDeviceTable = pgTable(
  "voice_device",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    organizationId: text("organization_id"),
    deviceType: varchar("device_type", {
      enum: ["m5stack_atom_echo_s3r"],
    }).notNull(),
    displayName: text("display_name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    status: varchar("status", {
      enum: ["active", "revoked"],
    })
      .notNull()
      .default("active"),
    firmwareVersion: text("firmware_version"),
    lastSeenAt: timestamp("last_seen_at"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("voice_device_user_idx").on(table.userId),
    index("voice_device_status_idx").on(table.status),
    index("voice_device_token_hash_idx").on(table.tokenHash),
  ],
);

export const VoiceDevicePairingCodeTable = pgTable(
  "voice_device_pairing_code",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    organizationId: text("organization_id"),
    deviceType: varchar("device_type", {
      enum: ["m5stack_atom_echo_s3r"],
    }).notNull(),
    displayName: text("display_name"),
    codeHash: text("code_hash").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("voice_pairing_user_idx").on(table.userId),
    index("voice_pairing_code_hash_idx").on(table.codeHash),
    index("voice_pairing_expires_idx").on(table.expiresAt),
  ],
);

export type VoiceDeviceEntity = typeof VoiceDeviceTable.$inferSelect;
export type VoiceDevicePairingCodeEntity =
  typeof VoiceDevicePairingCodeTable.$inferSelect;

export const VoiceDeviceRegistrationTable = pgTable(
  "voice_device_registration",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    codeHash: text("code_hash").notNull().unique(),
    deviceType: varchar("device_type", {
      enum: ["m5stack_atom_echo_s3r"],
    }).notNull(),
    firmwareVersion: text("firmware_version"),
    hardwareId: text("hardware_id"),
    displayName: text("display_name"),
    status: varchar("status", {
      enum: ["pending", "claimed", "completed", "expired"],
    })
      .notNull()
      .default("pending"),
    userId: uuid("user_id").references(() => UserTable.id, {
      onDelete: "set null",
    }),
    organizationId: text("organization_id"),
    deviceId: uuid("device_id").references(() => VoiceDeviceTable.id, {
      onDelete: "set null",
    }),
    deliveryToken: text("delivery_token"),
    expiresAt: timestamp("expires_at").notNull(),
    claimedAt: timestamp("claimed_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("voice_registration_status_idx").on(table.status),
    index("voice_registration_expires_idx").on(table.expiresAt),
    index("voice_registration_user_idx").on(table.userId),
    index("voice_registration_device_idx").on(table.deviceId),
  ],
);

export type VoiceDeviceRegistrationEntity =
  typeof VoiceDeviceRegistrationTable.$inferSelect;

// ── Slack "Navigator" bot integration (Composio-backed) ─────────────────────
// One row per connected Slack workspace. The Composio connected account is
// owned by the connecting user (Composio identity is per-user in this app),
// and one workspace-level mention trigger delivers events to our webhook.
export const SlackWorkspaceConnectionTable = pgTable(
  "slack_workspace_connection",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    // Composio connected account backing this workspace connection.
    composioConnectedAccountId: text("composio_connected_account_id")
      .notNull()
      .unique(),
    // Workspace-level Composio trigger instance (bot-mention events).
    composioTriggerId: text("composio_trigger_id"),
    composioTriggerSlug: text("composio_trigger_slug"),
    slackTeamId: text("slack_team_id"),
    slackTeamName: text("slack_team_name"),
    // Bot user id (U…). Learned from the first mention event when the
    // Slack API doesn't hand it to us at connect time.
    slackBotUserId: text("slack_bot_user_id"),
    status: varchar("status", { enum: ["active", "disconnected"] })
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("slack_connection_user_idx").on(table.userId),
    index("slack_connection_team_idx").on(table.slackTeamId),
  ],
);

// Channel allowlist: the bot only reacts in channels enabled here.
export const SlackChannelSubscriptionTable = pgTable(
  "slack_channel_subscription",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => SlackWorkspaceConnectionTable.id, {
        onDelete: "cascade",
      }),
    channelId: text("channel_id").notNull(),
    channelName: text("channel_name"),
    isPrivate: boolean("is_private").notNull().default(false),
    // Optional default agent whose instructions are applied in this channel.
    agentId: uuid("agent_id").references(() => AgentTable.id, {
      onDelete: "set null",
    }),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique("slack_channel_subscription_unique").on(
      table.connectionId,
      table.channelId,
    ),
    index("slack_subscription_channel_idx").on(table.channelId),
  ],
);

// One row per @navigator request handled from Slack (audit + dedupe + status).
export const SlackAgentTaskTable = pgTable(
  "slack_agent_task",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => SlackWorkspaceConnectionTable.id, {
        onDelete: "cascade",
      }),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => AgentTable.id, {
      onDelete: "set null",
    }),
    status: varchar("status", {
      enum: ["queued", "running", "done", "failed"],
    })
      .notNull()
      .default("queued"),
    input: text("input").notNull(),
    responseText: text("response_text"),
    error: text("error"),
    slackChannelId: text("slack_channel_id").notNull(),
    slackThreadTs: text("slack_thread_ts").notNull(),
    slackMessageTs: text("slack_message_ts").notNull(),
    slackUserId: text("slack_user_id"),
    // channelId:messageTs — Composio/Slack may deliver an event more than once.
    dedupeKey: text("dedupe_key").notNull().unique(),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("slack_agent_task_connection_idx").on(table.connectionId),
    index("slack_agent_task_status_idx").on(table.status),
  ],
);

export type SlackWorkspaceConnectionEntity =
  typeof SlackWorkspaceConnectionTable.$inferSelect;
export type SlackChannelSubscriptionEntity =
  typeof SlackChannelSubscriptionTable.$inferSelect;
export type SlackAgentTaskEntity = typeof SlackAgentTaskTable.$inferSelect;

export const PushSubscriptionTable = pgTable(
  "push_subscription",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique().on(table.userId, table.endpoint),
    index("push_subscription_user_idx").on(table.userId),
  ],
);

export type PushSubscriptionEntity = typeof PushSubscriptionTable.$inferSelect;

// In-app notifications (header bell) for background events, e.g. scheduled
// agent runs. threadId/agentId carry no FK so history survives deletion.
export const NotificationTable = pgTable(
  "notification",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 40 }).notNull(),
    title: text("title").notNull(),
    body: text("body"),
    threadId: uuid("thread_id"),
    agentId: uuid("agent_id"),
    // In-app deep link (e.g. /projects/<id>). Takes precedence over threadId.
    url: text("url"),
    // Idempotency key per user; a replayed producer cannot duplicate a row.
    dedupeKey: text("dedupe_key"),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("notification_user_read_idx").on(table.userId, table.readAt),
    index("notification_user_created_idx").on(table.userId, table.createdAt),
    uniqueIndex("notification_user_dedupe_idx")
      .on(table.userId, table.dedupeKey)
      .where(isNotNull(table.dedupeKey)),
  ],
);

export type NotificationEntity = typeof NotificationTable.$inferSelect;

/**
 * Encrypted credentials for one cockpit data source (migration 0066). Scoped
 * to an organization, or to the user alone when `organizationId` is null; one
 * row per scope and provider. `configEncrypted` is sealed with
 * `lib/crypto/secret-box.ts` and must never leave the server decrypted.
 */
export const CockpitConnectionTable = pgTable(
  "cockpit_connection",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").references(
      () => OrganizationTable.id,
      { onDelete: "cascade" },
    ),
    provider: varchar("provider", { length: 32 }).notNull(),
    label: text("label"),
    configEncrypted: text("config_encrypted").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    lastOkAt: timestamp("last_ok_at"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("cockpit_connection_scope_provider_idx").on(
      sql`COALESCE(${table.organizationId}, 'user:' || ${table.userId}::text)`,
      table.provider,
    ),
    index("cockpit_connection_user_idx").on(table.userId),
  ],
);

export type CockpitConnectionEntity =
  typeof CockpitConnectionTable.$inferSelect;

// Standalone knowledge bases: named Agentset namespaces filled from chat
// uploads and bound to agents for scoped retrieval. Namespace provisioning is
// lazy (slug kb-<id>), mirroring the per-project pattern. Org sharing follows
// the agent model: a null organizationId fails closed to owner-only.
export const KnowledgeBaseTable = pgTable(
  "knowledge_base",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").references(
      () => OrganizationTable.id,
      { onDelete: "cascade" },
    ),
    visibility: varchar("visibility", { enum: ["public", "private"] })
      .notNull()
      .default("private"),
    agentsetNamespaceId: text("agentset_namespace_id"),
    embeddingProfile: text("embedding_profile").default("agentset-managed"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("knowledge_base_user_idx").on(table.userId),
    index("knowledge_base_organization_idx").on(table.organizationId),
  ],
);

export type KnowledgeBaseEntity = typeof KnowledgeBaseTable.$inferSelect;

// In-product problem reports from the sidebar "Report an issue" dialog.
//
// The row is the source of truth; the Superlog incident and the notification
// mail raised by the same submission are best-effort side effects. `traceId` is
// what stitches a row back to the incident Superlog grouped it into.
// `organizationId` is `set null` rather than `cascade`: a deleted workspace
// must not take its bug reports with it.
export const ProblemReportTable = pgTable(
  "problem_report",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").references(
      () => OrganizationTable.id,
      { onDelete: "set null" },
    ),
    description: text("description").notNull(),
    // `{ key, url, name, contentType, size }[]`, uploaded via /api/storage/upload
    // before submit. Denormalised: attachments are only read back with the report.
    screenshots: jsonb("screenshots")
      .notNull()
      .default(sql`'[]'::jsonb`)
      .$type<ProblemReportScreenshot[]>(),
    // Page URL / user agent / locale — the "what were you looking at" that
    // users never think to include.
    context: jsonb("context").$type<ProblemReportContext>(),
    traceId: varchar("trace_id", { length: 32 }),
    status: varchar("status", { length: 16 }).notNull().default("open"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("problem_report_user_created_idx").on(table.userId, table.createdAt),
    index("problem_report_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("problem_report_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
  ],
);

export type ProblemReportEntity = typeof ProblemReportTable.$inferSelect;
