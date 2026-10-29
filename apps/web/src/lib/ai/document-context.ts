import { and, eq } from "drizzle-orm";
import { pgDb } from "@/lib/db/pg/db.pg";
import { DocumentTable } from "@/lib/db/pg/schema.pg";

export type ChatDocumentHandle = {
  slug: string;
  documentId: string;
  filename: string;
  contentType: string;
};

export async function getProjectDocumentHandles(params: {
  userId: string;
  projectId?: string | null;
}) {
  if (!params.projectId) return [];

  const docs = await pgDb
    .select({
      id: DocumentTable.id,
      filename: DocumentTable.filename,
      contentType: DocumentTable.contentType,
    })
    .from(DocumentTable)
    .where(
      and(
        eq(DocumentTable.userId, params.userId),
        eq(DocumentTable.projectId, params.projectId),
      ),
    );

  return docs.map((doc, index) => ({
    slug: `doc-${index + 1}`,
    documentId: doc.id,
    filename: doc.filename,
    contentType: doc.contentType,
  }));
}

export function buildDocumentContextPrompt(handles: ChatDocumentHandle[]) {
  if (!handles.length) return "";

  return `
<available_project_documents>
${handles
  .map((d) => `- ${d.slug}: ${d.filename} (documentId: ${d.documentId})`)
  .join("\n")}
</available_project_documents>

<document_tool_rules>
- Project knowledge is retrieved automatically via Agentset search and injected as numbered context chunks in <project_knowledge_retrieval>.
- Answer from that retrieved context and cite with inline [N] markers matching chunk numbers.
- Do not say you cannot access listed project documents when retrieval context is present.
</document_tool_rules>
`.trim();
}
