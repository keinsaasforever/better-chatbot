import "server-only";
import { pgDb } from "@/lib/db/pg/db.pg";
import { DocumentTable } from "@/lib/db/pg/schema.pg";
import { isNavigatorDocumentId } from "@/lib/agentset/chunk-metadata";
import { and, eq } from "drizzle-orm";

export type ProjectDocumentRow = {
  id: string;
  storageKey: string;
  filename: string;
  contentType: string;
  sourceProvider: string | null;
  agentsetDocumentId: string | null;
  agentsetIngestJobId: string | null;
};

const documentSelect = {
  id: DocumentTable.id,
  storageKey: DocumentTable.storageKey,
  filename: DocumentTable.filename,
  contentType: DocumentTable.contentType,
  sourceProvider: DocumentTable.sourceProvider,
  agentsetDocumentId: DocumentTable.agentsetDocumentId,
  agentsetIngestJobId: DocumentTable.agentsetIngestJobId,
};

export async function findProjectDocument(input: {
  projectId: string;
  documentRef: string;
}): Promise<ProjectDocumentRow | undefined> {
  const scope = and(eq(DocumentTable.projectId, input.projectId));

  if (isNavigatorDocumentId(input.documentRef)) {
    const [byNavigatorId] = await pgDb
      .select(documentSelect)
      .from(DocumentTable)
      .where(and(eq(DocumentTable.id, input.documentRef), scope))
      .limit(1);

    if (byNavigatorId) return byNavigatorId;
  }

  const [byAgentsetId] = await pgDb
    .select(documentSelect)
    .from(DocumentTable)
    .where(and(eq(DocumentTable.agentsetDocumentId, input.documentRef), scope))
    .limit(1);

  return byAgentsetId;
}
