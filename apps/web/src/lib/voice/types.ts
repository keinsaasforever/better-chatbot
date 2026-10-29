import { ChatMention } from "app-types/chat";
import { VoiceDeviceType } from "app-types/voice-device";

export type VoiceActorSource = "browser" | "m5stack";

export type VoiceActor = {
  userId: string;
  organizationId?: string | null;
  projectId?: string | null;
  source: VoiceActorSource;
  deviceId?: string;
};

export type VoiceToolExecutionInput = {
  actor: VoiceActor;
  toolName: string;
  /**
   * Which executor handles this call, as declared by the caller. Absent means
   * "work it out from the name", which is what the device transcript path and
   * every pre-Composio client do.
   */
  kind?: "mcp" | "app" | "composio";
  mcpServerId?: string;
  mcpToolName?: string;
  argumentsText?: string;
  arguments?: unknown;
  callId?: string;
  realtimeItemId?: string;
};

export type VoiceMcpToolReference = {
  serverId: string;
  serverName: string;
  toolName: string;
  exposedName?: string;
  description?: string;
};

export type VoiceToolStatus = {
  requested: VoiceMcpToolReference[];
  available: VoiceMcpToolReference[];
  unavailable: VoiceMcpToolReference[];
};

// `kind` is optional on the MCP arm so existing construction sites and
// serialized maps stay valid; a missing kind means "mcp".
export type VoiceToolExecutionTarget =
  | {
      kind?: "mcp";
      mcpServerId: string;
      mcpServerName: string;
      toolName: string;
    }
  | {
      kind: "app";
      toolName: string;
    }
  | {
      /**
       * Composio's Tool Router meta-tools. Only four of them exist regardless
       * of how many apps are connected — they are a search/execute interface,
       * not one schema per action — so offering them to a realtime session
       * costs about what one app tool does.
       */
      kind: "composio";
      toolName: string;
    };

export type VoiceToolExecutionMap = Record<string, VoiceToolExecutionTarget>;

export function createEmptyVoiceToolStatus(): VoiceToolStatus {
  return { requested: [], available: [], unavailable: [] };
}

export type VoiceToolExecutionResult = {
  ok: boolean;
  toolName: string;
  callId?: string;
  output: unknown;
  error?: {
    message: string;
    code?: string;
  };
};

export type RunTranscriptCommandInput = {
  actor: VoiceActor;
  text: string;
  sessionId: string;
  agentId?: string;
  mentions?: ChatMention[];
};

export type VoiceTranscriptAction = {
  toolName: string;
  ok: boolean;
  summary: string;
};

export type VoiceTranscriptIntent =
  | "task"
  | "workflow"
  | "agent"
  | "scheduled_agent"
  | "note"
  | "question"
  | "command"
  | "memory"
  | "mixed"
  | "unknown";

export type VoiceTranscriptActionStatus =
  | "stored"
  | "needs_review"
  | "executed"
  | "failed"
  | "ignored";

export type RunTranscriptCommandResult = {
  type: "agent.result";
  sessionId: string;
  message: string;
  actions: VoiceTranscriptAction[];
  /** Classified intent for this transcript. */
  intent?: VoiceTranscriptIntent;
  /** Project the transcript was filed under (null = none / transient). */
  projectId?: string | null;
  /** Persistence status to record on the transcript row. */
  actionStatus?: VoiceTranscriptActionStatus;
  /** Raw classifier metadata, stored on the transcript row. */
  classification?: Record<string, unknown>;
  /** Set when a task created a new chat thread. */
  createdThreadId?: string;
  /** Set when a workflow created a new draft. */
  createdWorkflowId?: string;
  /** Set when an agent was created from a voice transcript. */
  createdAgentId?: string;
  /** Set when a scheduled task was created for a voice-created agent. */
  createdScheduledTaskId?: string | null;
};

export const VOICE_DEVICE_TYPES = ["m5stack_atom_echo_s3r"] as const;

export type VoiceDeviceTypeValue = (typeof VOICE_DEVICE_TYPES)[number];

export function isVoiceDeviceType(value: string): value is VoiceDeviceType {
  return VOICE_DEVICE_TYPES.includes(value as VoiceDeviceTypeValue);
}

export const DEFAULT_VOICE_DEVICE_TYPE: VoiceDeviceType =
  "m5stack_atom_echo_s3r";

export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
