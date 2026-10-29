import { NextResponse } from "next/server";
import { withAuth } from "auth/route-guard";
import { serverFileStorage } from "lib/file-storage";
import { findProjectDocument } from "@/lib/projects/resolve-project-document";
import { syncAgentsetIngestJobStatus } from "@/lib/agentset/sync-status";
import {
  requireProjectAccess,
  toProjectErrorResponse,
} from "@/lib/projects/access";

/**
 * Generate signed URL for document download.
 *
 * Storage routing:
 * - sourceProvider = "agentset" → Agentset presigned download URL
 * - Otherwise → Supabase signed URL (existing behaviour)
 *
 * Query params:
 * - redirect=1 → 302 redirect to presigned URL (optional)
 */
export const GET = withAuth(
  async (
    request: Request,
    _session,
    { params }: { params: Promise<{ id: string; documentId: string }> },
  ) => {
    try {
      const { id: projectId, documentId } = await params;
      const redirect =
        new URL(request.url).searchParams.get("redirect") === "1";

      const { project } = await requireProjectAccess({ projectId });
      const document = await findProjectDocument({
        projectId,
        documentRef: documentId,
      });

      if (!document) {
        return NextResponse.json(
          { error: "Document not found" },
          { status: 404 },
        );
      }

      if (document.sourceProvider === "agentset") {
        if (!process.env.AGENTSET_API_KEY) {
          return NextResponse.json(
            { error: "Agentset is not configured" },
            { status: 503 },
          );
        }

        let agentsetDocumentId = document.agentsetDocumentId;

        if (!agentsetDocumentId && document.agentsetIngestJobId) {
          const synced = await syncAgentsetIngestJobStatus({
            documentId: document.id,
            projectId,
            userId: project.ownerUserId,
            ingestJobId: document.agentsetIngestJobId,
          });
          agentsetDocumentId = synced.agentsetDocumentId ?? null;
        }

        if (!agentsetDocumentId) {
          return NextResponse.json(
            { error: "Document is still indexing in Agentset" },
            { status: 409 },
          );
        }

        const { ensureProjectAgentsetNamespace } = await import(
          "@/lib/agentset/projects"
        );
        const ns = await ensureProjectAgentsetNamespace({
          projectId,
          userId: project.ownerUserId,
        });
        const { url } =
          await ns.documents.getFileDownloadUrl(agentsetDocumentId);

        if (redirect) {
          return NextResponse.redirect(url, 302);
        }

        return NextResponse.json({
          url,
          filename: document.filename,
          contentType: document.contentType,
          expiresIn: 3600,
        });
      }

      const signedUrl = await serverFileStorage.getSignedUrl?.(
        document.storageKey,
        3600,
      );

      if (!signedUrl) {
        return NextResponse.json(
          { error: "Failed to generate download URL" },
          { status: 500 },
        );
      }

      if (redirect) {
        return NextResponse.redirect(signedUrl, 302);
      }

      return NextResponse.json({
        url: signedUrl,
        filename: document.filename,
        contentType: document.contentType,
        expiresIn: 3600,
      });
    } catch (error) {
      const accessError = toProjectErrorResponse(error);
      if (accessError) return accessError;
      console.error("Failed to generate download URL:", error);
      return NextResponse.json(
        { error: "Failed to generate download URL" },
        { status: 500 },
      );
    }
  },
);
