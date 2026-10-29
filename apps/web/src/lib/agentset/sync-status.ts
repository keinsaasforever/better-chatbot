import "server-only";
import { trackUsage } from "@/lib/gate";
import { pgDb } from "@/lib/db/pg/db.pg";
import { DocumentTable } from "@/lib/db/pg/schema.pg";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  type AgentsetIngestJobSnapshot,
  fetchIngestJobSnapshot,
} from "./ingest-job-fetch";
import { deriveAgentsetPipelineStatus } from "./ingest-job-status";
import {
  ensureProjectAgentsetNamespace,
  formatAgentsetError,
} from "./projects";

export type { AgentsetDocumentStatus } from "./ingest-job-status";
export {
  deriveAgentsetPipelineStatus,
  isTerminalAgentsetDocumentStatus,
  mapAgentsetIngestJobStatus,
  mapAgentsetPipelineStatus,
} from "./ingest-job-status";

type AgentsetIngestDocument = {
  id?: string;
  status?: string | null;
  error?: string | null;
  completedAt?: string | null;
  failedAt?: string | null;
  totalChunks?: number | null;
  totalPages?: number | null;
  totalCharacters?: number | null;
  config?: {
    metadata?: {
      [key: string]: string | number | boolean | string[];
    };
  } | null;
};

export class AgentsetBillingSyncError extends Error {
  constructor(cause: unknown) {
    super("Agentset usage billing could not be synchronized", { cause });
    this.name = "AgentsetBillingSyncError";
  }
}

async function fetchIngestDocumentsForJob(
  documents: {
    all: (params: {
      ingestJobId: string;
      perPage: number;
    }) => Promise<{ documents: unknown[] }>;
  },
  ingestJobId: string,
) {
  try {
    const { documents: rows } = await documents.all({
      ingestJobId,
      perPage: 1,
    });
    return rows[0] as AgentsetIngestDocument | undefined;
  } catch (error) {
    console.warn("[agentset] document lookup during sync failed", {
      ingestJobId,
      error: formatAgentsetError(error),
    });
    return undefined;
  }
}

function resolveSyncedAgentsetStatus(input: {
  job: AgentsetIngestJobSnapshot | null;
  document?: AgentsetIngestDocument;
}) {
  return deriveAgentsetPipelineStatus({
    jobStatus: input.job?.status,
    jobCompletedAt: input.job?.completedAt,
    jobFailedAt: input.job?.failedAt,
    documentStatus: input.document?.status,
    documentCompletedAt: input.document?.completedAt,
    documentFailedAt: input.document?.failedAt,
  });
}

async function markAgentsetDocumentSyncFailed(
  documentId: string,
  error: unknown,
) {
  await pgDb
    .update(DocumentTable)
    .set({
      agentsetStatus: "failed",
      agentsetError: formatAgentsetError(error),
    })
    .where(eq(DocumentTable.id, documentId));
}

export async function syncAgentsetIngestJobStatus(input: {
  documentId: string;
  projectId: string;
  userId: string;
  ingestJobId: string;
  /** Use the ingest create response on upload; avoids a flaky immediate GET. */
  jobSnapshot?: AgentsetIngestJobSnapshot;
}) {
  const ns = await ensureProjectAgentsetNamespace(input);

  const job =
    input.jobSnapshot ??
    (await fetchIngestJobSnapshot(ns.ingestion, input.ingestJobId));

  const document = await fetchIngestDocumentsForJob(
    ns.documents,
    input.ingestJobId,
  );

  const status = resolveSyncedAgentsetStatus({ job, document });

  const agentsetDocumentId = document?.id;
  const errorMessage =
    status === "failed"
      ? (document?.error ?? job?.error ?? "Ingestion failed")
      : null;

  const billingMetadata = document?.config?.metadata;
  const billingCustomerId =
    typeof billingMetadata?.billingCustomerId === "string"
      ? billingMetadata.billingCustomerId
      : undefined;
  const billingEntityId =
    typeof billingMetadata?.billingEntityId === "string"
      ? billingMetadata.billingEntityId
      : undefined;
  const sourceType =
    typeof billingMetadata?.sourceType === "string"
      ? billingMetadata.sourceType
      : undefined;
  if (status === "completed" && billingCustomerId && document) {
    if (document.totalCharacters == null) {
      throw new AgentsetBillingSyncError(
        new Error("Completed Agentset document has no totalCharacters"),
      );
    }

    const parsedPages = Math.ceil(document.totalCharacters / 1_000);
    try {
      await trackUsage({
        kind: "agentset",
        customerId: billingCustomerId,
        entityId: billingEntityId,
        parsedPages,
        documentId: input.documentId,
        idempotencyKey: `agentset:${agentsetDocumentId ?? input.ingestJobId}`,
        properties: {
          ingestJobId: input.ingestJobId,
          agentsetDocumentId,
          projectId: input.projectId,
          totalCharacters: document.totalCharacters,
          sourceType,
        },
      });
    } catch (error) {
      throw new AgentsetBillingSyncError(error);
    }
  }

  await pgDb
    .update(DocumentTable)
    .set({
      agentsetStatus: status,
      agentsetError: errorMessage,
      ...(agentsetDocumentId ? { agentsetDocumentId } : {}),
    })
    .where(eq(DocumentTable.id, input.documentId));

  return { job, document, status, agentsetDocumentId };
}

export async function syncPendingAgentsetDocumentsForProject(input: {
  projectId: string;
  userId: string;
}) {
  const pendingDocuments = await pgDb
    .select({
      id: DocumentTable.id,
      agentsetIngestJobId: DocumentTable.agentsetIngestJobId,
    })
    .from(DocumentTable)
    .where(
      and(
        eq(DocumentTable.projectId, input.projectId),
        eq(DocumentTable.userId, input.userId),
        inArray(DocumentTable.agentsetStatus, ["pending", "processing"]),
        isNotNull(DocumentTable.agentsetIngestJobId),
      ),
    );

  await Promise.all(
    pendingDocuments.map(async (document) => {
      try {
        await syncAgentsetIngestJobStatus({
          documentId: document.id,
          projectId: input.projectId,
          userId: input.userId,
          ingestJobId: document.agentsetIngestJobId!,
        });
      } catch (error) {
        console.error("[agentset] ingest job sync failed", {
          documentId: document.id,
          projectId: input.projectId,
          error,
        });
        if (error instanceof AgentsetBillingSyncError) {
          return;
        }
        await markAgentsetDocumentSyncFailed(document.id, error);
      }
    }),
  );
}
