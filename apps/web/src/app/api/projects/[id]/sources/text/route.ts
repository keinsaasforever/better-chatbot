import { Buffer } from "node:buffer";
import { processProjectDocument } from "@/lib/ai/rag/ingest";
import { requireBillingContext } from "@/lib/gate";
import { enqueueProjectBrainRun } from "@/lib/project-brain/enqueue";
import {
  requireProjectAccess,
  toProjectErrorResponse,
} from "@/lib/projects/access";
import { TextSourceSchema } from "@/lib/projects/text-source-schema";
import { generateUUID } from "lib/utils";
import { NextResponse } from "next/server";

/**
 * Ingest pasted text (meeting transcripts, notes) as a project source:
 * stored as a text document with local chunks/embeddings, mirrored into
 * Agentset when configured, and fed to the project brain pipeline.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params;
    const { actor } = await requireProjectAccess({
      projectId,
      minRole: "editor",
    });

    const parsed = TextSourceSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_source",
            message: parsed.error.issues[0]?.message ?? "Invalid source text.",
          },
        },
        { status: 400 },
      );
    }

    const title =
      parsed.data.title && parsed.data.title.length > 0
        ? parsed.data.title
        : `Pasted text ${new Date().toISOString().slice(0, 10)}`;
    const filename = `${
      title
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "pasted-source"
    }.txt`;

    // Local chunks always exist so the brain run can read the document even
    // when retrieval itself is served by Agentset.
    const { documentId } = await processProjectDocument({
      fileBuffer: Buffer.from(parsed.data.text, "utf-8"),
      projectId,
      userId: actor.userId,
      storageKey: `paste/${projectId}/${generateUUID()}`,
      filename,
      contentType: "text/plain",
    });

    if (process.env.AGENTSET_API_KEY) {
      try {
        const billingContext = await requireBillingContext();
        const { ingestProjectTextIntoAgentset } = await import(
          "@/lib/agentset/ingest-text"
        );
        await ingestProjectTextIntoAgentset({
          userId: actor.userId,
          projectId,
          documentId,
          title,
          text: parsed.data.text,
          billing: {
            customerId: billingContext.customerId,
            entityId: billingContext.entityId,
          },
        });
      } catch (agentsetError) {
        // Best-effort: local chunks already cover the brain; log and move on.
        console.error(
          "[sources/text] Agentset text ingest failed",
          agentsetError,
        );
      }
    }

    const run = await enqueueProjectBrainRun({
      projectId,
      actorUserId: actor.userId,
      sourceType: "document",
      sourceRef: documentId,
      sourceScope: `document:${documentId}`,
      trigger: "document_ingested",
      idempotencyKey: `paste:${documentId}`,
    });

    return NextResponse.json({ documentId, runId: run.id }, { status: 201 });
  } catch (error) {
    return toProjectErrorResponse(error);
  }
}
