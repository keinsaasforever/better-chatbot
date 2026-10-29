import {
  AGENTSET_EMBEDDING_PROFILE_IDS,
  type AgentsetEmbeddingProfileId,
} from "@/types/project";

export type AgentsetEmbeddingProfileOption = {
  id: AgentsetEmbeddingProfileId;
  label: string;
  description: string;
  providerLabel: string;
  modelLabel: string;
};

export const AGENTSET_EMBEDDING_PROFILE_OPTIONS: AgentsetEmbeddingProfileOption[] =
  [
    {
      id: "agentset-managed",
      label: "Agentset managed",
      description:
        "Recommended. Uses Agentset's managed OpenAI text-embedding-3-large configuration.",
      providerLabel: "Agentset",
      modelLabel: "Managed (text-embedding-3-large)",
    },
    {
      id: "openai-text-embedding-3-large",
      label: "OpenAI text-embedding-3-large",
      description:
        "Higher recall for complex documents. Uses Agentset managed OpenAI large embeddings.",
      providerLabel: "OpenAI (managed)",
      modelLabel: "text-embedding-3-large",
    },
    {
      id: "openai-text-embedding-3-small",
      label: "OpenAI text-embedding-3-small",
      description:
        "Lower cost for simpler collections. Requires OPENAI_API_KEY on the server.",
      providerLabel: "OpenAI",
      modelLabel: "text-embedding-3-small",
    },
    {
      id: "voyage",
      label: "Voyage",
      description:
        "Strong retrieval on long-form text. Requires VOYAGE_API_KEY on the server.",
      providerLabel: "Voyage",
      modelLabel: "voyage-3",
    },
    {
      id: "google",
      label: "Google",
      description:
        "Google text-embedding-004. Requires GOOGLE_GENERATIVE_AI_API_KEY on the server.",
      providerLabel: "Google",
      modelLabel: "text-embedding-004",
    },
    {
      id: "azure-openai",
      label: "Azure OpenAI",
      description:
        "Azure-hosted embeddings. Requires AZURE_OPENAI_* env vars on the server.",
      providerLabel: "Azure OpenAI",
      modelLabel: "text-embedding-3-small / large",
    },
  ];

export function getAgentsetEmbeddingProfileOption(
  id?: string | null,
): AgentsetEmbeddingProfileOption {
  return (
    AGENTSET_EMBEDDING_PROFILE_OPTIONS.find((option) => option.id === id) ??
    AGENTSET_EMBEDDING_PROFILE_OPTIONS[0]
  );
}

export function isAgentsetEmbeddingProfileId(
  value: string,
): value is AgentsetEmbeddingProfileId {
  return AGENTSET_EMBEDDING_PROFILE_IDS.includes(
    value as AgentsetEmbeddingProfileId,
  );
}
