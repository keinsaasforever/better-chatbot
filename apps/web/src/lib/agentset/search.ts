import "server-only";
import { ensureProjectAgentsetNamespace } from "./projects";
import {
  getAgentsetRetrievalMinScore,
  getAgentsetRetrievalRerankLimit,
} from "./retrieval-config";

export async function searchAgentsetProject(input: {
  userId: string;
  projectId: string;
  query: string;
  topK?: number;
  minScore?: number;
  rerankLimit?: number;
  mode?: "semantic" | "keyword";
}) {
  const ns = await ensureProjectAgentsetNamespace(input);

  return ns.search(input.query, {
    topK: input.topK ?? 20,
    rerank: true,
    rerankLimit: input.rerankLimit ?? getAgentsetRetrievalRerankLimit(),
    minScore: input.minScore ?? getAgentsetRetrievalMinScore(),
    mode: input.mode ?? "semantic",
    includeMetadata: true,
  });
}
