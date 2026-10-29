import "server-only";
import { pgDb } from "@/lib/db/pg/db.pg";
import { DocumentTable } from "@/lib/db/pg/schema.pg";
import { eq } from "drizzle-orm";
import { ensureProjectAgentsetNamespace } from "./projects";

/**
 * Ingest raw pasted text (e.g. a meeting transcript) into the project's
 * Agentset namespace so it is retrievable alongside uploaded documents.
 * Local pgvector chunks are written separately by the caller — this call is
 * best-effort RAG parity for Agentset-backed projects.
 */
export async function ingestProjectTextIntoAgentset(input: {
  userId: string;
  projectId: string;
  documentId: string;
  title: string;
  text: string;
  billing: {
    /** Null when the edition has no billing customer; pages go untracked. */
    customerId: string | null;
    entityId?: string;
  };
}) {
  const ns = await ensureProjectAgentsetNamespace(input);

  const job = await ns.ingestion.create({
    name: input.title,
    payload: {
      type: "TEXT",
      text: input.text,
      fileName: `paste-${input.documentId}.txt`,
    },
    config: {
      metadata: {
        projectId: input.projectId,
        userId: input.userId,
        documentId: input.documentId,
        ...(input.billing.customerId
          ? { billingCustomerId: input.billing.customerId }
          : {}),
        ...(input.billing.entityId
          ? { billingEntityId: input.billing.entityId }
          : {}),
        sourceType: "pasted_text",
        title: input.title,
      },
    },
  });

  await pgDb
    .update(DocumentTable)
    .set({
      agentsetIngestJobId: job.id,
      agentsetStatus: "processing",
    })
    .where(eq(DocumentTable.id, input.documentId));

  return job;
}
