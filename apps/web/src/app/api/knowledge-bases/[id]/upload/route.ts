import { NextResponse } from "next/server";
import { withAuth } from "auth/route-guard";
import { pgDb } from "@/lib/db/pg/db.pg";
import { KnowledgeBaseTable } from "@/lib/db/pg/schema.pg";
import { eq } from "drizzle-orm";
import { canAccessKnowledgeBase } from "@/lib/agentset/knowledge-base-access";
import { ingestKnowledgeBaseFile } from "@/lib/agentset/knowledge-bases";

/**
 * POST /api/knowledge-bases/[id]/upload
 * Ingest a file into the knowledge base's Agentset namespace (provisioned
 * lazily on first upload).
 */
export const POST = withAuth(
  async (
    request: Request,
    session,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      if (!process.env.AGENTSET_API_KEY) {
        return NextResponse.json(
          { error: "Knowledge base storage is not configured" },
          { status: 503 },
        );
      }

      const { id } = await params;
      const [knowledgeBase] = await pgDb
        .select()
        .from(KnowledgeBaseTable)
        .where(eq(KnowledgeBaseTable.id, id))
        .limit(1);

      const activeOrganizationId =
        (
          session.session as
            | { activeOrganizationId?: string | null }
            | undefined
        )?.activeOrganizationId ?? null;

      if (
        !knowledgeBase ||
        !canAccessKnowledgeBase(knowledgeBase, {
          userId: session.user.id,
          activeOrganizationId,
        })
      ) {
        return NextResponse.json(
          { error: "Knowledge base not found" },
          { status: 404 },
        );
      }

      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return NextResponse.json(
          { error: "No file provided. Use 'file' field in FormData." },
          { status: 400 },
        );
      }

      const { upload, job } = await ingestKnowledgeBaseFile({
        knowledgeBaseId: knowledgeBase.id,
        userId: session.user.id,
        file,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
      });

      return NextResponse.json({
        success: true,
        knowledgeBaseId: knowledgeBase.id,
        agentsetUploadKey: upload.key,
        agentsetJobId: job.id,
      });
    } catch (error) {
      console.error("Failed to upload knowledge base file", error);
      return NextResponse.json(
        { error: "Failed to upload file" },
        { status: 500 },
      );
    }
  },
);
