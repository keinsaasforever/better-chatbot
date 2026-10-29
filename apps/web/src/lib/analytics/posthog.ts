import * as backend from "./client";

/**
 * Type-safe analytics helper
 *
 * This module provides the typed event surface; `./client` is the backend it
 * reports to, and is the only edition-specific part.
 *
 * Usage:
 * ```typescript
 * import { analytics } from '@/lib/analytics/posthog';
 *
 * analytics.userSignedIn({ method: 'email', userId: user.id });
 * analytics.chatMessageSent({ threadId, modelId, tokenCount });
 * ```
 */

/**
 * Analytics event types
 * Based on .posthog-events.json
 */

// Auth Events
export interface UserSignedInProps {
  method: "email" | "google" | "github" | "microsoft";
  userId: string;
  email?: string;
}

export interface UserSignedUpProps {
  method: "email" | "google" | "github" | "microsoft";
  userId: string;
  email?: string;
  isFirstUser?: boolean;
}

// Agent Events
export interface AgentCreatedProps {
  agentId: string;
  name: string;
  visibility: "private" | "public" | "readonly";
  toolsCount?: number;
}

export interface AgentDeletedProps {
  agentId: string;
  name?: string;
}

export interface AgentVisibilityChangedProps {
  agentId: string;
  oldVisibility: "private" | "public" | "readonly";
  newVisibility: "private" | "public" | "readonly";
}

// Workflow Events
export interface WorkflowCreatedProps {
  workflowId: string;
  name: string;
  visibility: "private" | "public" | "readonly";
  nodesCount?: number;
}

export interface WorkflowDeletedProps {
  workflowId: string;
  name?: string;
}

export interface WorkflowVisibilityChangedProps {
  workflowId: string;
  oldVisibility: "private" | "public" | "readonly";
  newVisibility: "private" | "public" | "readonly";
}

export interface WorkflowSavedProps {
  workflowId: string;
  nodesCount?: number;
  edgesCount?: number;
}

// MCP Events
export interface McpServerCreatedProps {
  serverId: string;
  serverName: string;
  serverType?: string;
}

// Chat Events
export interface ChatMessageSentProps {
  threadId: string;
  modelId?: string;
  hasAttachments?: boolean;
  attachmentCount?: number;
  characterCount?: number;
}

export interface ChatThreadDeletedProps {
  threadId: string;
  messageCount?: number;
}

export interface ChatErrorOccurredProps {
  threadId?: string;
  errorType: string;
  errorMessage?: string;
}

/**
 * Type-safe analytics wrapper
 */
export const analytics = {
  /**
   * Identify a user
   */
  identify(userId: string, properties?: Record<string, unknown>) {
    backend.identify(userId, properties);
  },

  /**
   * Reset user identity (on logout)
   */
  reset() {
    backend.reset();
  },

  // Auth Events
  userSignedIn(props: UserSignedInProps) {
    backend.capture("user_signed_in", props);
  },

  userSignedUp(props: UserSignedUpProps) {
    backend.capture("user_signed_up", props);
  },

  // Agent Events
  agentCreated(props: AgentCreatedProps) {
    backend.capture("agent_created", props);
  },

  agentDeleted(props: AgentDeletedProps) {
    backend.capture("agent_deleted", props);
  },

  agentVisibilityChanged(props: AgentVisibilityChangedProps) {
    backend.capture("agent_visibility_changed", props);
  },

  // Workflow Events
  workflowCreated(props: WorkflowCreatedProps) {
    backend.capture("workflow_created", props);
  },

  workflowDeleted(props: WorkflowDeletedProps) {
    backend.capture("workflow_deleted", props);
  },

  workflowVisibilityChanged(props: WorkflowVisibilityChangedProps) {
    backend.capture("workflow_visibility_changed", props);
  },

  workflowSaved(props: WorkflowSavedProps) {
    backend.capture("workflow_saved", props);
  },

  // MCP Events
  mcpServerCreated(props: McpServerCreatedProps) {
    backend.capture("mcp_server_created", props);
  },

  // Chat Events
  chatMessageSent(props: ChatMessageSentProps) {
    backend.capture("chat_message_sent", props);
  },

  chatThreadDeleted(props: ChatThreadDeletedProps) {
    backend.capture("chat_thread_deleted", props);
  },

  chatErrorOccurred(props: ChatErrorOccurredProps) {
    backend.capture("chat_error_occurred", props);
  },

  /**
   * Generic event capture for custom events
   */
  capture(eventName: string, properties?: Record<string, unknown>) {
    backend.capture(eventName, properties);
  },
};
