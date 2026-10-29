import "server-only";
import { getAgentsetClient } from "./client";
import {
  getAgentsetEmbeddingProfileOption,
  type AgentsetEmbeddingProfileOption,
} from "./embedding-profile-options";

type NamespaceCreateInput = Parameters<
  ReturnType<typeof getAgentsetClient>["namespaces"]["create"]
>[0];

type AgentsetEmbeddingConfig = NonNullable<
  NamespaceCreateInput["embeddingConfig"]
>;

export type AgentsetEmbeddingProfileId = AgentsetEmbeddingProfileOption["id"];

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `[agentset] Missing ${name} for the selected embedding profile.`,
    );
  }
  return value;
}

function buildEmbeddingConfig(
  profileId: AgentsetEmbeddingProfileId,
): AgentsetEmbeddingConfig | undefined {
  switch (profileId) {
    case "agentset-managed":
      return undefined;
    case "openai-text-embedding-3-large":
      return {
        provider: "MANAGED_OPENAI",
        model: "text-embedding-3-large",
      };
    case "openai-text-embedding-3-small":
      return {
        provider: "OPENAI",
        model: "text-embedding-3-small",
        apiKey: requireEnv("OPENAI_API_KEY"),
      };
    case "voyage":
      return {
        provider: "VOYAGE",
        model: "voyage-3",
        apiKey: requireEnv("VOYAGE_API_KEY"),
      };
    case "google":
      return {
        provider: "GOOGLE",
        model: "text-embedding-004",
        apiKey: requireEnv("GOOGLE_GENERATIVE_AI_API_KEY"),
      };
    case "azure-openai":
      return {
        provider: "AZURE_OPENAI",
        model:
          (process.env.AZURE_OPENAI_EMBEDDING_MODEL as
            | "text-embedding-3-small"
            | "text-embedding-3-large") ?? "text-embedding-3-small",
        resourceName: requireEnv("AZURE_OPENAI_RESOURCE_NAME"),
        deployment: requireEnv("AZURE_OPENAI_EMBEDDING_DEPLOYMENT"),
        apiKey: requireEnv("AZURE_OPENAI_API_KEY"),
        apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? "preview",
      };
    default:
      return undefined;
  }
}

export function getAgentsetEmbeddingProfile(id?: string) {
  const option = getAgentsetEmbeddingProfileOption(id);
  return {
    ...option,
    embeddingConfig: buildEmbeddingConfig(option.id),
  };
}
