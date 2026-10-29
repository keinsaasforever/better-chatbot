export const AGENTSET_EMBEDDING_PROFILE_IDS = [
  "agentset-managed",
  "openai-text-embedding-3-large",
  "openai-text-embedding-3-small",
  "voyage",
  "google",
  "azure-openai",
] as const;

export type AgentsetEmbeddingProfileId =
  (typeof AGENTSET_EMBEDDING_PROFILE_IDS)[number];
