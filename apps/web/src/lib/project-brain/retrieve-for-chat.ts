import "server-only";
import { formatAgentsetSearchContext } from "@/lib/agentset/citation-context";
import { filterRelevantRetrievalResults } from "@/lib/agentset/filter-relevant-results";
import { searchProjectKnowledge } from "@/lib/agentset/retrieval";
import { getAgentsetRetrievalRerankLimit } from "@/lib/agentset/retrieval-config";
import { shouldRetrieveForQuery } from "@/lib/agentset/should-retrieve-for-query";
import type { RetrievalSource } from "@/lib/citations/retrieval-source";
import { pgDb } from "@/lib/db/pg/db.pg";
import {
  ProjectBrainAliasTable,
  ProjectBrainFactTable,
  ProjectBrainPageTable,
  ProjectTable,
} from "@/lib/db/pg/schema.pg";
import { and, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { getLatestProjectStatusSnapshot } from "./generated-insights";
import { traverse } from "./graph-query";
import { rrfFuse } from "./rank-fusion";
import {
  keywordSearchProjectBrainChunks,
  loadCompiledTruthChunksForPages,
  searchProjectBrainChunks,
} from "./search-local";

export type ProjectRetrievalResult = {
  prompt: string;
  sources: RetrievalSource[];
};

/** Query terms worth matching against the alias table. */
function graphTerms(query: string) {
  return [
    ...new Set(
      query
        .split(/[^\p{L}\p{N}.@-]+/u)
        .map((term) => term.trim().toLowerCase())
        .filter((term) => term.length >= 3),
    ),
  ].slice(0, 6);
}

/**
 * Entities the question names, with their current facts and 1-hop typed
 * edges rendered as `A -works_at-> B`. Alias-based, so "Alex" finds
 * "Alexander Wessels"; archived (merged) pages are skipped.
 */
async function getProjectGraphContext(projectId: string, query: string) {
  const terms = graphTerms(query);
  if (!terms.length) return { facts: [], edges: [] };

  const matched = await pgDb
    .selectDistinct({
      pageId: ProjectBrainAliasTable.pageId,
      title: ProjectBrainPageTable.title,
    })
    .from(ProjectBrainAliasTable)
    .innerJoin(
      ProjectBrainPageTable,
      eq(ProjectBrainPageTable.id, ProjectBrainAliasTable.pageId),
    )
    .where(
      and(
        eq(ProjectBrainAliasTable.projectId, projectId),
        isNull(ProjectBrainPageTable.archivedAt),
        or(
          ...terms.map((term) =>
            ilike(ProjectBrainAliasTable.normalizedAlias, `%${term}%`),
          ),
        ),
      ),
    )
    .limit(6);
  if (!matched.length) return { facts: [], edges: [] };

  const pageIds = matched.map((row) => row.pageId);
  const [facts, subgraph] = await Promise.all([
    pgDb
      .select({
        pageTitle: ProjectBrainPageTable.title,
        key: ProjectBrainFactTable.factKey,
        value: ProjectBrainFactTable.value,
      })
      .from(ProjectBrainFactTable)
      .innerJoin(
        ProjectBrainPageTable,
        eq(ProjectBrainPageTable.id, ProjectBrainFactTable.pageId),
      )
      .where(
        and(
          eq(ProjectBrainFactTable.projectId, projectId),
          eq(ProjectBrainFactTable.status, "current"),
          inArray(ProjectBrainFactTable.pageId, pageIds),
        ),
      )
      .orderBy(desc(ProjectBrainFactTable.lastObservedAt))
      .limit(12),
    traverse({ projectId, startPageIds: pageIds, depth: 1, limit: 40 }),
  ]);

  const title = new Map(subgraph.nodes.map((node) => [node.id, node.title]));
  const edges = subgraph.edges
    .filter((edge) => edge.linkType !== "mentions")
    .slice(0, 20)
    .map(
      (edge) =>
        `${title.get(edge.fromPageId) ?? "?"} -${edge.linkType}-> ${title.get(edge.toPageId) ?? "?"}`,
    );

  return { facts, edges };
}

/** Compiled truth of the 1-hop neighbours of hub pages (gbrain adjacency boost). */
async function adjacencyBoost(projectId: string, hubPageIds: string[]) {
  const subgraph = await traverse({
    projectId,
    startPageIds: hubPageIds,
    depth: 1,
    limit: 30,
  });
  const hubs = new Set(hubPageIds);
  const neighbourIds = subgraph.nodes
    .filter((node) => !hubs.has(node.id) && node.depth === 1)
    .sort((a, b) => b.salience - a.salience)
    .slice(0, 4)
    .map((node) => node.id);
  return loadCompiledTruthChunksForPages({
    projectId,
    pageIds: neighbourIds,
    limit: 4,
  });
}

export async function buildProjectRetrievalPrompt(input: {
  userId: string;
  projectId: string;
  query: string;
}): Promise<ProjectRetrievalResult> {
  const trimmed = input.query.trim();
  if (!shouldRetrieveForQuery(trimmed)) {
    return { prompt: "", sources: [] };
  }

  const [
    projectResult,
    agentsetResult,
    vectorChunks,
    ftsChunks,
    statusSnapshot,
    graphFacts,
  ] = await Promise.allSettled([
    pgDb
      .select({ memoryEnabled: ProjectTable.memoryEnabled })
      .from(ProjectTable)
      .where(eq(ProjectTable.id, input.projectId))
      .limit(1),
    searchProjectKnowledge({
      userId: input.userId,
      projectId: input.projectId,
      query: trimmed,
      limit: getAgentsetRetrievalRerankLimit(),
    }),
    searchProjectBrainChunks({
      projectId: input.projectId,
      query: trimmed,
      limit: 8,
    }),
    keywordSearchProjectBrainChunks({
      projectId: input.projectId,
      query: trimmed,
      limit: 8,
    }),
    getLatestProjectStatusSnapshot(input.projectId),
    getProjectGraphContext(input.projectId, trimmed),
  ]);

  if (
    projectResult.status !== "fulfilled" ||
    !projectResult.value[0]?.memoryEnabled
  ) {
    return { prompt: "", sources: [] };
  }

  const parts: string[] = [];
  const sources: RetrievalSource[] = [];

  if (agentsetResult.status === "fulfilled") {
    const { backend, results } = agentsetResult.value;
    const relevantResults = filterRelevantRetrievalResults(results);
    if (relevantResults.length) {
      const context = formatAgentsetSearchContext(relevantResults);
      const sourceIndex = relevantResults
        .map((result) => {
          const idSuffix = result.documentId
            ? ` | documentId: ${result.documentId}`
            : "";
          const pageSuffix =
            result.pageNumber != null ? ` | page: ${result.pageNumber}` : "";
          const chunkSuffix = result.chunkId
            ? ` | chunkId: ${result.chunkId}`
            : "";
          return `[${result.rank}] ${result.source}${idSuffix}${pageSuffix}${chunkSuffix}`;
        })
        .join("\n");
      // Retrieved content only. The citation rules that describe it are static
      // and live in the system prompt (AGENTSET_CITATION_GUIDELINES) so they
      // stay cacheable while this block changes every turn.
      parts.push(`<project_knowledge_retrieval backend="${backend}">
${context}
</project_knowledge_retrieval>

Source index (for <CITATIONS> filenames and documentId values):
${sourceIndex}`);
      sources.push(...relevantResults);
    }
  } else {
    console.error("[project retrieval] agentset failed", {
      projectId: input.projectId,
      error: agentsetResult.reason,
    });
  }

  // Hybrid ranking: vector and keyword lists fused by reciprocal rank, raw
  // source chunks demoted when compiled truth is present, then an adjacency
  // boost pulls in the 1-hop neighbours of pages that are hubs for this query.
  const fused = rrfFuse([
    vectorChunks.status === "fulfilled" ? vectorChunks.value : [],
    ftsChunks.status === "fulfilled" ? ftsChunks.value : [],
  ]);
  const hasCompiled = fused.some(
    (row) => row.item.chunk_type === "compiled_truth",
  );
  const ranked = fused
    .map((row) => ({
      ...row,
      score:
        hasCompiled && row.item.chunk_type === "raw_source"
          ? row.score * 0.7
          : row.score,
    }))
    .sort((a, b) => b.score - a.score);

  const hubPageIds = ranked
    .slice(0, 3)
    .filter((row) => row.item.page_id && row.hits >= 2)
    .map((row) => row.item.page_id as string);
  const boosted = hubPageIds.length
    ? await adjacencyBoost(input.projectId, hubPageIds).catch(() => [])
    : [];

  const seen = new Set<string>();
  const uniqueChunks = [...ranked.map((row) => row.item), ...boosted].filter(
    (c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    },
  );

  if (uniqueChunks.length) {
    const chunkText = uniqueChunks
      .map((c, i) => `[brain:${i + 1}] (${c.chunk_type}) ${c.content}`)
      .join("\n\n");
    parts.push(`<project_brain_memory>
${chunkText}
</project_brain_memory>`);
  }

  if (statusSnapshot.status === "fulfilled" && statusSnapshot.value?.summary) {
    parts.push(`<project_current_status>
${statusSnapshot.value.summary}
</project_current_status>`);
  }

  if (
    graphFacts.status === "fulfilled" &&
    (graphFacts.value.facts.length || graphFacts.value.edges.length)
  ) {
    const factLines = graphFacts.value.facts.map(
      (fact) => `- ${fact.pageTitle}: ${fact.key} = ${fact.value}`,
    );
    const edgeLines = graphFacts.value.edges.map((edge) => `- ${edge}`);
    parts.push(`<project_knowledge_graph>
${[...factLines, ...(edgeLines.length ? ["Relations:", ...edgeLines] : [])].join("\n")}
</project_knowledge_graph>`);
  }

  if (!parts.length) {
    return { prompt: "", sources: [] };
  }

  return {
    prompt: parts.join("\n\n"),
    sources,
  };
}
