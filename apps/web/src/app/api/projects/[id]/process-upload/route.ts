import { formatAgentsetError } from "@/lib/agentset/projects";
import { requireBillingContext } from "@/lib/gate";
import { pgDb } from "@/lib/db/pg/db.pg";
import { DocumentTable } from "@/lib/db/pg/schema.pg";
import {
  requireProjectAccess,
  toProjectErrorResponse,
} from "@/lib/projects/access";
import { withAuth } from "auth/route-guard";
import { serverFileStorage } from "lib/file-storage";
import { generateUUID } from "lib/utils";
import { NextResponse } from "next/server";

/**
 * Process uploaded file for RAG ingestion.
 *
 * Called after a file has been uploaded to Supabase Storage via TUS resumable
 * upload. When AGENTSET_API_KEY is configured, the file is re-uploaded to
 * Agentset managed storage and ingested there instead of local pgvector.
 */
export const POST = withAuth(
  async (
    request: Request,
    session,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id: projectId } = await params;
      const { actor } = await requireProjectAccess({
        projectId,
        minRole: "editor",
      });
      const { storageKey, filename, contentType, embeddingModel } =
        await request.json();

      if (!storageKey || !filename) {
        return NextResponse.json(
          { error: "storageKey and filename are required" },
          { status: 400 },
        );
      }

      // Download file from Supabase Storage (TUS upload path)
      const buffer = await serverFileStorage.download(storageKey);

      // Agentset path: forward to Agentset managed storage
      if (process.env.AGENTSET_API_KEY) {
        try {
          const billingContext = await requireBillingContext();
          const documentId = generateUUID();

          await pgDb.insert(DocumentTable).values({
            id: documentId,
            projectId,
            userId: session.user.id,
            storageKey,
            filename,
            contentType: contentType || "application/octet-stream",
            size: buffer.byteLength,
            sourceProvider: "agentset",
            agentsetStatus: "pending",
          });

          const { ingestProjectFileIntoAgentset } = await import(
            "@/lib/agentset/ingest-project-document"
          );

          const fileObj = new File([new Uint8Array(buffer)], filename, {
            type: contentType || "application/octet-stream",
          });

          const { upload, job } = await ingestProjectFileIntoAgentset({
            documentId,
            projectId,
            userId: actor.userId,
            file: fileObj,
            filename,
            contentType: contentType || "application/octet-stream",
            billing: {
              customerId: billingContext.customerId,
              entityId: billingContext.entityId,
            },
          });

          const { AgentsetBillingSyncError, syncAgentsetIngestJobStatus } =
            await import("@/lib/agentset/sync-status");
          let syncedStatus = "processing";
          try {
            const synced = await syncAgentsetIngestJobStatus({
              documentId,
              projectId,
              userId: actor.userId,
              ingestJobId: job.id,
              jobSnapshot: job,
            });
            syncedStatus = synced.status;
          } catch (error) {
            if (!(error instanceof AgentsetBillingSyncError)) {
              throw error;
            }
            console.error(
              "[process-upload] Agentset billing sync deferred",
              error,
            );
          }

          return NextResponse.json({
            success: true,
            documentId,
            agentsetUploadKey: upload.key,
            agentsetJobId: job.id,
            agentsetStatus: syncedStatus,
            storageKey,
            filename,
            projectId,
            provider: "agentset",
          });
        } catch (agentsetError) {
          console.error(
            "[process-upload] Agentset ingestion failed",
            agentsetError,
          );
          return NextResponse.json(
            {
              error: "Failed to ingest document into Agentset",
              code: "agentset_ingest_failed",
              details: formatAgentsetError(agentsetError),
            },
            { status: 500 },
          );
        }
      }

      // Local RAG fallback
      try {
        const { processProjectDocument } = await import("@/lib/ai/rag/ingest");
        await processProjectDocument({
          fileBuffer: buffer,
          projectId,
          userId: session.user.id,
          storageKey,
          filename,
          contentType: contentType || "application/octet-stream",
          embeddingModel: embeddingModel || "text-embedding-3-small",
        });
      } catch (ingestError) {
        console.error("RAG Ingestion failed:", ingestError);
        return NextResponse.json(
          { error: "Failed to process file for RAG" },
          { status: 500 },
        );
      }

      return NextResponse.json({
        success: true,
        storageKey,
        filename,
        projectId,
        embeddingModel,
        provider: "local",
      });
    } catch (error) {
      const accessError = toProjectErrorResponse(error);
      if (accessError) return accessError;
      console.error("Failed to process project file", error);
      return NextResponse.json(
        { error: "Failed to process file" },
        { status: 500 },
      );
    }
  },
);
