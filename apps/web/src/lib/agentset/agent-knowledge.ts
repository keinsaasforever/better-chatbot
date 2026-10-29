import "server-only";
import { pgDb } from "@/lib/db/pg/db.pg";
import { KnowledgeBaseTable, ProjectTable } from "@/lib/db/pg/schema.pg";
import { inArray } from "drizzle-orm";
import type { AgentKnowledgeBaseBinding } from "app-types/agent";
import type { RetrievalSource } from "@/lib/citations/retrieval-source";
import { formatAgentsetSearchContext } from "./citation-context";
import { filterRelevantRetrievalResults } from "./filter-relevant-results";
import { canAccessKnowledgeBase } from "./knowledge-base-access";
import { searchKnowledgeBaseNamespaces } from "./knowledge-bases";
import { shouldRetrieveForQuery } from "./should-retrieve-for-query";

export type AgentKnowledgeRetrievalResult = {
  prompt: string;
  sources: RetrievalSource[];
};

const EMPTY: AgentKnowledgeRetrievalResult = { prompt: "", sources: [] };

/**
 * Resolves an agent's knowledge-base bindings to namespaces the CALLER may
 * search (owner/org scoping re-checked here — the stored ids are never
 * trusted), searches them, and formats the hits for the system prompt.
 * Namespaces that are not yet provisioned (nothing ingested) are skipped.
 */
export async function buildAgentKnowledgeRetrievalPrompt(input: {
  userId: string;
  activeOrganizationId?: string | null;
  query: string;
  bindings: AgentKnowledgeBaseBinding[];
  /** Skip a project already covered by the thread's own project retrieval. */
  excludeProjectId?: string | null;
}): Promise<AgentKnowledgeRetrievalResult> {
  if (!process.env.AGENTSET_API_KEY) return EMPTY;
  const query = input.query.trim();
  if (!input.bindings.length || !shouldRetrieveForQuery(query)) return EMPTY;

  const kbIds = input.bindings.filter((b) => b.type === "kb").map((b) => b.id);
  const projectIds = input.bindings
    .filter((b) => b.type === "project" && b.id !== input.excludeProjectId)
    .map((b) => b.id);

  const [kbRows, projectRows] = await Promise.all([
    kbIds.length
      ? pgDb
          .select({
            id: KnowledgeBaseTable.id,
            userId: KnowledgeBaseTable.userId,
            organizationId: KnowledgeBaseTable.organizationId,
            visibility: KnowledgeBaseTable.visibility,
            agentsetNamespaceId: KnowledgeBaseTable.agentsetNamespaceId,
          })
          .from(KnowledgeBaseTable)
          .where(inArray(KnowledgeBaseTable.id, kbIds))
      : Promise.resolve([]),
    projectIds.length
      ? pgDb
          .select({
            id: ProjectTable.id,
            ownerUserId: ProjectTable.ownerUserId,
            agentsetNamespaceId: ProjectTable.agentsetNamespaceId,
          })
          .from(ProjectTable)
          .where(inArray(ProjectTable.id, projectIds))
      : Promise.resolve([]),
  ]);

  const namespaceIds = [
    ...kbRows
      .filter((kb) =>
        canAccessKnowledgeBase(kb, {
          userId: input.userId,
          activeOrganizationId: input.activeOrganizationId,
        }),
      )
      .map((kb) => kb.agentsetNamespaceId),
    // Project bindings resolve owner-only (fail closed); shared-project
    // retrieval can widen later through the project-member model if needed.
    ...projectRows
      .filter((project) => project.ownerUserId === input.userId)
      .map((project) => project.agentsetNamespaceId),
  ].filter((id): id is string => !!id);

  if (!namespaceIds.length) return EMPTY;

  const results = await searchKnowledgeBaseNamespaces({
    namespaceIds: [...new Set(namespaceIds)],
    query,
  });
  const relevantResults = filterRelevantRetrievalResults(results);
  if (!relevantResults.length) return EMPTY;

  const context = formatAgentsetSearchContext(relevantResults);
  const sourceIndex = relevantResults
    .map((result) => {
      const idSuffix = result.documentId
        ? ` | documentId: ${result.documentId}`
        : "";
      const pageSuffix =
        result.pageNumber != null ? ` | page: ${result.pageNumber}` : "";
      const chunkSuffix = result.chunkId ? ` | chunkId: ${result.chunkId}` : "";
      return `[${result.rank}] ${result.source}${idSuffix}${pageSuffix}${chunkSuffix}`;
    })
    .join("\n");

  return {
    // Retrieved content only - the citation rules live in the system prompt
    // (AGENTSET_CITATION_GUIDELINES) so they stay byte-stable and cacheable.
    prompt: `<agent_knowledge_retrieval>
${context}
</agent_knowledge_retrieval>

Source index (for <CITATIONS> filenames and documentId values):
${sourceIndex}`,
    sources: relevantResults,
  };
}
