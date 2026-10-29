import type { ProjectKnowledgeHit } from "./retrieval";

/** Number chunks per https://docs.agentset.ai/search-and-retrieval/citations */
export function formatAgentsetSearchContext(results: ProjectKnowledgeHit[]) {
  return results
    .map((result) => `[${result.rank}] ${result.content}`)
    .join("\n\n");
}

/**
 * Citation rules for retrieved knowledge.
 *
 * Deliberately static and free of retrieved content: this belongs in the system
 * prompt, where it is byte-stable and therefore cacheable, while the chunks it
 * describes travel with the user's message. Interpolating context here would
 * change the system prompt on every turn and invalidate the whole cached
 * prefix - which is what this constant exists to avoid.
 */
export const AGENTSET_CITATION_GUIDELINES = `
When knowledge search finds something, the results arrive with the user's message inside <project_knowledge_retrieval> or <agent_knowledge_retrieval> tags. Use them only when they help answer the user's message.

Guidelines:
1. For conversational messages (greetings, thanks, acknowledgments), respond normally without citations and without a <CITATIONS> block.
2. When answering from project documents, cite only chunks you actually used. Place the chunk number in brackets immediately after the statement with no space, like: "The temperature is 20 degrees[3]"
3. Do not cite or quote chunks that were not used in your answer.
4. If the context does not contain information to answer a document question, say so clearly instead of guessing.
5. When helpful, include relevant quotes from the context with citations.
6. Optionally include a <CITATIONS> block with verbatim supporting quotes for cited chunks only:
<CITATIONS>
[3] "verbatim quote from chunk" — Source filename | documentId: DOCUMENT_UUID
</CITATIONS>
`.trim();
