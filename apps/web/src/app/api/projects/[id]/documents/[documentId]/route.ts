import { NextResponse } from "next/server";
import { withAuth } from "auth/route-guard";
import { pgDb } from "@/lib/db/pg/db.pg";
import { DocumentTable, ProjectTable } from "@/lib/db/pg/schema.pg";
import { eq, and } from "drizzle-orm";
import { serverFileStorage } from "@/lib/file-storage";
import {
  requireProjectAccess,
  toProjectErrorResponse,
} from "@/lib/projects/access";

export const DELETE = withAuth(
  async (
    _request: Request,
    _session,
    { params }: { params: Promise<{ id: string; documentId: string }> },
  ) => {
    const { id: projectId, documentId } = await params;

    try {
      await requireProjectAccess({ projectId, minRole: "editor" });
      const [document] = await pgDb
        .select({
          id: DocumentTable.id,
          storageKey: DocumentTable.storageKey,
          sourceProvider: DocumentTable.sourceProvider,
          agentsetDocumentId: DocumentTable.agentsetDocumentId,
          agentsetNamespaceId: ProjectTable.agentsetNamespaceId,
        })
        .from(DocumentTable)
        .innerJoin(ProjectTable, eq(ProjectTable.id, DocumentTable.projectId))
        .where(
          and(
            eq(DocumentTable.id, documentId),
            eq(DocumentTable.projectId, projectId),
          ),
        )
        .limit(1);

      if (!document) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      if (
        document.sourceProvider === "agentset" &&
        document.agentsetDocumentId &&
        document.agentsetNamespaceId &&
        process.env.AGENTSET_API_KEY
      ) {
        try {
          const { deleteAgentsetDocument } = await import(
            "@/lib/agentset/deletion"
          );
          await deleteAgentsetDocument({
            namespaceId: document.agentsetNamespaceId,
            agentsetDocumentId: document.agentsetDocumentId,
          });
        } catch (agentsetError) {
          console.error("[documents.delete] Agentset delete failed", {
            projectId,
            documentId,
            error: agentsetError,
          });
          return NextResponse.json(
            {
              error:
                "Failed to delete document from Agentset; please retry or clear it from the Agentset dashboard.",
            },
            { status: 502 },
          );
        }
      }

      if (document.storageKey) {
        try {
          await serverFileStorage.delete(document.storageKey);
        } catch (storageError) {
          console.warn("[documents.delete] storage delete failed", {
            projectId,
            documentId,
            storageKey: document.storageKey,
            error: storageError,
          });
        }
      }

      // DocumentChunkTable and DocumentEmbeddingTable cascade on DocumentTable
      // via schema FK definitions, so a single delete here cleans everything up.
      await pgDb.delete(DocumentTable).where(eq(DocumentTable.id, documentId));

      return NextResponse.json({ success: true });
    } catch (error) {
      const accessError = toProjectErrorResponse(error);
      if (accessError) return accessError;
      console.error("[documents.delete] failed", {
        projectId,
        documentId,
        error,
      });
      return NextResponse.json(
        { error: "Failed to delete document" },
        { status: 500 },
      );
    }
  },
);
