import type { ChatModel } from "app-types/chat";

export type RoutingTaskKey =
  | "general_chat"
  | "coding"
  | "web_development"
  | "web_search"
  | "document_extraction"
  | "tool_calling"
  | "german_business_writing"
  | "writing"
  | "reasoning"
  | "vision";

export type RouteSignals = {
  taskKey: RoutingTaskKey;
  requiresTools: boolean;
  requiresVision: boolean;
  requiredRegion?: string;
  requiredRetention?: "zero" | "standard";
  minimumContextTokens: number;
};

export type RoutingProfile = {
  taskKey: RoutingTaskKey;
  score: number;
  tieBreakPriority: number;
  bestTaskDescription: string;
};

export type RoutingCandidate = {
  deploymentId: string;
  modelId: string;
  chatModel: ChatModel;
  providerModelId: string;
  region: string | null;
  dataRetention: "unknown" | "zero" | "standard";
  inputPriceMicrosPerMillion: number;
  outputPriceMicrosPerMillion: number;
  contextTokens: number;
  supportsTools: boolean;
  supportsVision: boolean;
  active: boolean;
  profiles: RoutingProfile[];
};

export type OrganizationRoutingPolicy = {
  allowedDeploymentIds?: Set<string>;
  allowedRegions?: string[] | null;
  maxInputPriceMicrosPerMillion?: number | null;
  maxOutputPriceMicrosPerMillion?: number | null;
};

export type DeterministicRoute = {
  candidate: RoutingCandidate;
  taskKey: RoutingTaskKey;
  taskScore: number;
  reasonCode: string;
};

export class RoutingPolicyError extends Error {
  constructor(
    public readonly code:
      | "NO_ELIGIBLE_MODEL"
      | "MANUAL_MODEL_NOT_ALLOWED"
      | "AUTOMATIC_ROUTING_DISABLED",
    message: string,
  ) {
    super(message);
    this.name = "RoutingPolicyError";
  }
}
