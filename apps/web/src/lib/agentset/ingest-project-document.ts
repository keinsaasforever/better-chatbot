import "server-only";
import { pgDb } from "@/lib/db/pg/db.pg";
import { DocumentTable } from "@/lib/db/pg/schema.pg";
import { eq } from "drizzle-orm";
import { ensureProjectAgentsetNamespace } from "./projects";

export async function ingestProjectFileIntoAgentset(input: {
  documentId: string;
  projectId: string;
  userId: string;
  file: File;
  filename: string;
  contentType: string;
  billing: {
    /** Null when the edition has no billing customer; pages go untracked. */
    customerId: string | null;
    entityId?: string;
  };
}) {
  const ns = await ensureProjectAgentsetNamespace({
    projectId: input.projectId,
    userId: input.userId,
  });

  const upload = await ns.uploads.upload({
    file: input.file,
    contentType: input.contentType,
  });

  const job = await ns.ingestion.create({
    name: input.filename,
    payload: {
      type: "MANAGED_FILE",
      key: upload.key,
      fileName: input.filename,
    },
    config: {
      metadata: {
        projectId: input.projectId,
        userId: input.userId,
        navigatorDocumentId: input.documentId,
        documentId: input.documentId,
        filename: input.filename,
        filetype: input.contentType,
        ...(input.billing.customerId
          ? { billingCustomerId: input.billing.customerId }
          : {}),
        ...(input.billing.entityId
          ? { billingEntityId: input.billing.entityId }
          : {}),
        sourceType: "project_upload",
      },
    },
  });

  await pgDb
    .update(DocumentTable)
    .set({
      sourceProvider: "agentset",
      sourceKey: upload.key,
      agentsetUploadKey: upload.key,
      agentsetIngestJobId: job.id,
      agentsetStatus: "processing",
    })
    .where(eq(DocumentTable.id, input.documentId));

  return { upload, job };
}
