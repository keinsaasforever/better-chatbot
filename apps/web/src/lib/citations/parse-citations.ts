/**
 * Citation utilities: parse [N] inline citations and <CITATIONS> blocks.
 * Mirrors the citation format from Mike's chatTools.ts system prompt.
 *
 * Format:
 *   Inline: ... some text [1][3] ...
 *   Block (at end of response):
 *   <CITATIONS>
 *   [1] "verbatim quote from document" — Document Title
 *   [3] "another quote" — Other Document
 *   </CITATIONS>
 */

export interface ParsedCitation {
  index: number;
  quote: string;
  documentTitle?: string;
  documentId?: string;
  url?: string;
  chunkId?: string;
  relevance?: number;
  pageNumber?: number;
  figureUrls?: string[];
  agentsetDocumentId?: string;
}

export interface CitationParseResult {
  text: string;
  citations: ParsedCitation[];
}

const CITATION_BLOCK_RE = /<CITATIONS>([\s\S]*?)<\/CITATIONS>/i;
const CITATION_ENTRY_RE =
  /^\[(\d+)\]\s+"([^"]+)"(?:\s+[—–-]\s+(.+?))?(?:\s+\|\s+documentId:\s*(\S+))?$/;
const INLINE_CITATION_RE = /\[(\d+)\]/g;

function parseCitationTitle(raw?: string) {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const withoutId = trimmed.replace(/\s+\|\s+documentId:\s*\S+$/, "").trim();
  return withoutId || undefined;
}

export function parseCitations(response: string): CitationParseResult {
  const blockMatch = CITATION_BLOCK_RE.exec(response);
  const citations: ParsedCitation[] = [];

  if (blockMatch) {
    const block = blockMatch[1];
    for (const line of block.split("\n")) {
      const trimmed = line.trim();
      const m = CITATION_ENTRY_RE.exec(trimmed);
      if (m) {
        citations.push({
          index: parseInt(m[1], 10),
          quote: m[2],
          documentTitle: parseCitationTitle(m[3]),
          documentId: m[4]?.trim(),
        });
      }
    }
  }

  const text = response.replace(CITATION_BLOCK_RE, "").trim();
  return { text, citations };
}

export function hasCitationMarkup(text: string): boolean {
  CITATION_BLOCK_RE.lastIndex = 0;
  INLINE_CITATION_RE.lastIndex = 0;
  return CITATION_BLOCK_RE.test(text) || INLINE_CITATION_RE.test(text);
}

export function getCitationsForIndex(
  citations: ParsedCitation[],
  index: number,
): ParsedCitation[] {
  return citations.filter((c) => c.index === index);
}

export function buildDocumentDownloadUrl(
  projectId: string,
  documentId: string,
): string {
  return `/api/projects/${projectId}/documents/${documentId}/download`;
}

export function extractInlineCitationIndices(text: string): number[] {
  const indices: number[] = [];
  let m: RegExpExecArray | null;
  INLINE_CITATION_RE.lastIndex = 0;
  while ((m = INLINE_CITATION_RE.exec(text)) !== null) {
    indices.push(parseInt(m[1], 10));
  }
  return [...new Set(indices)];
}

export function buildCitationSystemPrompt(
  documents: { id: string; title: string }[],
): string {
  if (documents.length === 0) return "";
  const docList = documents
    .map((d, i) => `[Doc ${i + 1}] ${d.title} (documentId: ${d.id})`)
    .join("\n");
  return `
You have access to the following uploaded documents:
${docList}

Citation rules:
- When citing retrieved excerpts or document content, use inline [N] markers where N is the source number from <project_knowledge_retrieval> when present.
- Otherwise cite using the document list order above as [1], [2], etc.
- Multiple citations on the same claim: [1][2].
- At the end of your response, include a <CITATIONS> block with verbatim quotes:
<CITATIONS>
[1] "verbatim quote that supports the claim" — Document Title | documentId: DOCUMENT_UUID
</CITATIONS>
- Always include documentId in the citation block when you know it — this enables source downloads.
- Copy quotes verbatim (including punctuation) so they can be highlighted in the source.
`.trim();
}
