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

      const formData = await request.formData();
      const file = formData.get("file") as File;
      const embeddingModel =
        (formData.get("embeddingModel") as string) || "text-embedding-3-small";

      if (!file) {
        return NextResponse.json(
          { error: "No file provided. Use 'file' field in FormData." },
          { status: 400 },
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const documentId = generateUUID();

      // Agentset path: upload directly to Agentset managed storage
      if (process.env.AGENTSET_API_KEY) {
        try {
          const billingContext = await requireBillingContext();
          await pgDb.insert(DocumentTable).values({
            id: documentId,
            projectId,
            userId: session.user.id,
            storageKey: `agentset/${documentId}`,
            filename: file.name,
            contentType: file.type || "application/octet-stream",
            size: buffer.byteLength,
            sourceProvider: "agentset",
            agentsetStatus: "pending",
          });

          const { ingestProjectFileIntoAgentset } = await import(
            "@/lib/agentset/ingest-project-document"
          );

          const fileObj = new File([new Uint8Array(buffer)], file.name, {
            type: file.type || "application/octet-stream",
          });

          const { upload, job } = await ingestProjectFileIntoAgentset({
            documentId,
            projectId,
            userId: actor.userId,
            file: fileObj,
            filename: file.name,
            contentType: file.type || "application/octet-stream",
            billing: {
              customerId: billingContext.customerId,
              entityId: billingContext.entityId,
            },
          });

          return NextResponse.json({
            success: true,
            documentId,
            agentsetUploadKey: upload.key,
            agentsetJobId: job.id,
            projectId,
            embeddingModel,
            provider: "agentset",
          });
        } catch (agentsetError) {
          console.error("[upload] Agentset ingestion failed", agentsetError);
          return NextResponse.json(
            { error: "Failed to ingest document into Agentset" },
            { status: 500 },
          );
        }
      }

      // Local RAG fallback: upload to Supabase Storage
      const result = await serverFileStorage.upload(buffer, {
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        userId: session.user.id,
        projectId,
        uploadType: "knowledge-base",
      });

      try {
        const { processProjectDocument } = await import("@/lib/ai/rag/ingest");
        await processProjectDocument({
          fileBuffer: buffer,
          projectId,
          userId: session.user.id,
          storageKey: result.key,
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          embeddingModel,
        });
      } catch (ingestError) {
        console.error("RAG Ingestion failed:", ingestError);
      }

      return NextResponse.json({
        success: true,
        key: result.key,
        url: result.sourceUrl,
        metadata: result.metadata,
        projectId,
        embeddingModel,
        provider: "local",
      });
    } catch (error) {
      const accessError = toProjectErrorResponse(error);
      if (accessError) return accessError;
      console.error("Failed to upload project file", error);
      return NextResponse.json(
        { error: "Failed to upload file" },
        { status: 500 },
      );
    }
  },
);
