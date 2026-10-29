/**
 * Model metadata and badge types
 */

export interface ModelBadges {
  hiddenGem?: boolean;
  caution?: boolean;
  notRecommended?: boolean;
  cheapAlternative?: boolean;
  speed?: boolean;
  thinking?: boolean;
  maxPerformance?: boolean;
}

export interface ModelMetadata {
  model: string;
  developer: string;
  country?: string | null;
  text: boolean;
  hiddenGem?: boolean;
  caution?: boolean;
  notRecommended?: boolean;
  cheapAlternative?: boolean;
  speed?: boolean;
  thinking?: boolean;
  maxPerformance?: boolean;
  /**
   * Catalog price in USD per million tokens. Drizzle returns `numeric` as a
   * string to avoid the precision loss a float would introduce, and either
   * column may be null for a model nobody has priced yet.
   */
  inputPriceUsd?: string | null;
  outputPriceUsd?: string | null;
}

export type ModelCapability =
  | "chat"
  | "reasoning"
  | "tools"
  | "vision"
  | "audio"
  | "long_context";

export type ModelRoutingTaskType =
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

export interface ModelRoutingProfile {
  taskTypes: ModelRoutingTaskType[];
  useCases: string[];
  avoidUseCases: string[];
  strengths: string[];
  limitations: string[];
  capabilityScores: {
    reasoning: number;
    coding: number;
    toolUse: number;
    extraction: number;
    writing: number;
  };
}
