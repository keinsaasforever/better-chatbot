import type { AgentKnowledgeBaseBinding } from "app-types/agent";
import type { RetrievalSource } from "@/lib/citations/retrieval-source";
import type { LanguageModelUsage, UIMessage } from "ai";
import {
  MAX_ATTACHMENT_URL_CHARS,
  MAX_INGESTED_ATTACHMENTS,
} from "@/lib/ai/ingest/limits";
import { tag } from "lib/tag";
import { z } from "zod";
import { AllowedMCPServerZodSchema } from "./mcp";
import { UserPreferences } from "./user";

export type ChatMetadata = {
  usage?: LanguageModelUsage;
  chatModel?: ChatModel;
  routing?: {
    automatic: boolean;
    taskKey?: string;
    reasonCode?: string;
    /**
     * `provider/model` this thread ran on last turn, recorded only when it
     * differs from the model serving this one. A switch throws away the
     * prompt cache, so this is what makes the cost of that churn countable -
     * and `automatic` above says whether routing or the user caused it.
     */
    switchedFrom?: string;
  };
  toolChoice?: "auto" | "none" | "manual";
  toolCount?: number;
  /**
   * A tool stopped because it needed a person: today, the browser agent hitting
   * an identity check with nobody to answer it.
   *
   * The turn itself still finishes normally (`finishReason: "stop"`), so
   * without this a scheduled run would be recorded as a success that did
   * nothing. Set from the tool during the run and read off the terminal
   * `finish` frame by `lib/scheduled-tasks/chat-failure`.
   */
  blocked?: { source: string; reason: string };
  runId?: string;
  runStatus?:
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "timed_out"
    | "cancelled"
    // The model stopped before finishing — output-token truncation
    // (finishReason "length") or content filtering. Distinct from a clean
    // "completed" so the UI can offer to continue.
    | "incomplete";
  finishReason?: string;
  rawFinishReason?: string;
  warnings?: string[];
  lastCompletedStep?: number;
  agentId?: string;
  retrievalSources?: RetrievalSource[];
  // `navigator_*`: written by a Navigator tool called over MCP or from the
  // cockpit (lib/navigator-tools), not typed in the chat UI.
  source?:
    | "voice_transcript"
    | "voice_realtime"
    | "navigator_mcp"
    | "navigator_cockpit";
  voiceSessionId?: string;
  error?: {
    code: string;
    retryable: boolean;
  };
};

export type ChatModel = {
  provider: string;
  model: string;
};

export const ChatAttachmentSchema = z.object({
  type: z.enum(["file", "source-url"]),
  // Bounded because every entry costs a storage download and a parse before
  // the stream opens, and this array is client-supplied.
  url: z.string().max(MAX_ATTACHMENT_URL_CHARS),
  mediaType: z.string().max(255).optional(),
  filename: z.string().max(1024).optional(),
});

export type ChatAttachment = z.infer<typeof ChatAttachmentSchema>;

export type ChatThread = {
  id: string;
  title: string;
  userId: string;
  projectId?: string;
  /** Knowledge sources attached to this thread from the composer. */
  knowledgeBases?: AgentKnowledgeBaseBinding[];
  createdAt: Date;
};

export type ChatMessage = {
  id: string;
  threadId: string;
  role: UIMessage["role"];
  parts: UIMessage["parts"];
  metadata?: ChatMetadata;
  createdAt: Date;
};

export const ChatMentionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("mcpTool"),
    name: z.string(),
    description: z.string().optional(),
    serverName: z.string().optional(),
    serverId: z.string(),
  }),
  z.object({
    type: z.literal("defaultTool"),
    name: z.string(),
    label: z.string(),
    description: z.string().optional(),
  }),
  z.object({
    type: z.literal("mcpServer"),
    name: z.string(),
    description: z.string().optional(),
    toolCount: z.number().optional(),
    serverId: z.string(),
  }),
  z.object({
    type: z.literal("workflow"),
    name: z.string(),
    description: z.string().nullish(),
    workflowId: z.string(),
    icon: z
      .object({
        type: z.literal("emoji"),
        value: z.string(),
        style: z.record(z.string(), z.string()).optional(),
      })
      .nullish(),
  }),
  z.object({
    type: z.literal("agent"),
    name: z.string(),
    description: z.string().nullish(),
    agentId: z.string(),
    icon: z
      .object({
        type: z.literal("emoji"),
        value: z.string(),
        style: z.record(z.string(), z.string()).optional(),
      })
      .nullish(),
  }),
  z.object({
    type: z.literal("skill"),
    name: z.string(),
    description: z.string().nullish(),
    skillId: z.string(),
    icon: z
      .object({
        type: z.literal("emoji"),
        value: z.string(),
        style: z.record(z.string(), z.string()).optional(),
      })
      .nullish(),
  }),
  // A knowledge source attached to the thread from the composer. Mirrors the
  // agent's `AgentKnowledgeBaseBinding` shape (`sourceType`/`id`) so both
  // paths resolve through the same retrieval builder. The id is a reference,
  // never a grant — access is re-validated server-side at retrieval time.
  z.object({
    type: z.literal("knowledgeBase"),
    name: z.string(),
    description: z.string().nullish(),
    /** Knowledge base id, or the project id when `sourceType` is "project". */
    knowledgeBaseId: z.string().uuid(),
    sourceType: z.enum(["kb", "project"]),
  }),
]);

export type ChatMention = z.infer<typeof ChatMentionSchema>;

export const chatApiSchemaRequestBodySchema = z.object({
  id: z.string(),
  // UIMessage parts are validated by AI SDK's safeValidateUIMessages in the
  // route. Keeping this boundary unknown prevents an unchecked `any` payload
  // from being treated as a trusted message before that validation runs.
  message: z.unknown().transform((value) => value as UIMessage),
  chatModel: z
    .object({
      provider: z.string(),
      model: z.string(),
    })
    .optional(),
  autoRouting: z.boolean().optional().default(false),
  toolChoice: z.enum(["auto", "none", "manual"]),
  planMode: z.boolean().optional().default(false),
  mentions: z.array(ChatMentionSchema).optional(),
  imageTool: z
    .object({
      model: z.string().optional(),
      // A brush mask drawn on one uploaded image in the composer. Both are
      // public storage URLs; the image tool hands them to the inpainting
      // model, so a mask forces the tool on even without a model pick.
      mask: z
        .object({
          imageUrl: z.string().url().max(MAX_ATTACHMENT_URL_CHARS),
          maskUrl: z.string().url().max(MAX_ATTACHMENT_URL_CHARS),
        })
        .optional(),
    })
    .optional(),
  allowedMcpServers: z.record(z.string(), AllowedMCPServerZodSchema).optional(),
  allowedAppDefaultToolkit: z.array(z.string()).optional(),
  attachments: z
    .array(ChatAttachmentSchema)
    .max(MAX_INGESTED_ATTACHMENTS)
    .optional(),
  projectId: z.string().optional(),
});

export type ChatApiSchemaRequestBody = z.infer<
  typeof chatApiSchemaRequestBodySchema
>;

export type ChatRepository = {
  insertThread(thread: Omit<ChatThread, "createdAt">): Promise<ChatThread>;

  insertThreadWithDefaults(thread: Omit<ChatThread, "createdAt">): Promise<
    ChatThread & {
      messages: ChatMessage[];
      userPreferences?: UserPreferences;
    }
  >;

  selectThread(id: string): Promise<ChatThread | null>;

  deleteChatMessage(id: string, userId: string): Promise<void>;

  selectThreadDetails(id: string): Promise<
    | (ChatThread & {
        messages: ChatMessage[];
        userPreferences?: UserPreferences;
      })
    | null
  >;

  selectMessagesByThreadId(
    threadId: string,
    opts?: { limit?: number; beforeMessageId?: string },
  ): Promise<ChatMessage[]>;

  selectThreadsByUserId(userId: string): Promise<
    (ChatThread & {
      lastMessageAt: number;
    })[]
  >;

  updateThread(
    id: string,
    thread: Partial<Omit<ChatThread, "id" | "createdAt">>,
  ): Promise<ChatThread>;

  deleteThread(id: string): Promise<void>;

  upsertThread(
    thread: PartialBy<Omit<ChatThread, "createdAt">, "userId">,
  ): Promise<ChatThread>;

  /**
   * Replaces the thread's attached knowledge sources, scoped to its owner.
   * A no-op (resolves false) when the thread does not exist yet or belongs to
   * someone else, so a stale client cannot create or repoint a thread.
   */
  setThreadKnowledgeBases(
    id: string,
    userId: string,
    knowledgeBases: AgentKnowledgeBaseBinding[],
  ): Promise<boolean>;

  /**
   * Sets the title only while the thread is still untitled and returns the
   * effective title. Titling can be attempted concurrently by the chat run and
   * by the client, so first write wins and the loser reports the stored title
   * rather than overwriting it.
   */
  setThreadTitleIfEmpty(id: string, title: string): Promise<string>;

  insertMessage(message: Omit<ChatMessage, "createdAt">): Promise<ChatMessage>;
  upsertMessage(message: Omit<ChatMessage, "createdAt">): Promise<ChatMessage>;

  deleteMessagesByChatIdAfterTimestamp(
    messageId: string,
    userId: string,
  ): Promise<void>;

  deleteAllThreads(userId: string): Promise<void>;

  deleteUnarchivedThreads(userId: string): Promise<void>;

  checkAccess(id: string, userId: string): Promise<boolean>;

  insertMessages(
    messages: PartialBy<ChatMessage, "createdAt">[],
  ): Promise<ChatMessage[]>;
};

export const ManualToolConfirmTag = tag<{
  confirm: boolean;
}>("manual-tool-confirm");
